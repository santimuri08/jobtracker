# backend/app/routers/chats.py
"""
Chat persistence endpoints (Phase 4).

Six endpoints:
  GET    /api/v1/chats                  - list my chats (id, title, count, timestamps)
  POST   /api/v1/chats                  - create empty chat (idempotent on id)
  GET    /api/v1/chats/{id}             - get one chat with all messages
  PATCH  /api/v1/chats/{id}             - update title
  DELETE /api/v1/chats/{id}             - delete chat (cascades to messages)
  PUT    /api/v1/chats/{id}/messages    - replace entire message list

All endpoints require auth. Every query filters chat.user_id == current_user.id.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Chat, ChatMessage
from app.schemas import (
    ChatCreateIn,
    ChatDetail,
    ChatListItem,
    ChatListOut,
    ChatMessageIn,
    ChatMessageOut,
    ChatUpdateIn,
    MessagesReplaceIn,
    MessagesReplaceOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chats", tags=["chats"])


# ---------- helpers ----------

def _generate_chat_id() -> str:
    """
    Generate a chat id matching the frontend's nanoid-style format.
    Used when the client POSTs without specifying an id.
    """
    return f"ch_{secrets.token_urlsafe(12)}"


def _get_user_chat(db: Session, user_id: str, chat_id: str) -> Chat | None:
    """Fetch a chat scoped to the current user, or None."""
    return (
        db.query(Chat)
        .filter(Chat.id == chat_id, Chat.user_id == user_id)
        .first()
    )


def _derive_title(messages: list[ChatMessageIn], max_len: int = 60) -> str | None:
    """
    Derive a title from the first user message. Used on first PUT
    only — once a chat has a non-null title, it's never overwritten
    automatically (the user may have renamed it via PATCH).
    """
    for m in messages:
        if m.role != "user":
            continue
        text = ""
        if isinstance(m.content, str):
            text = m.content
        elif isinstance(m.content, list):
            # First text block, if any
            for block in m.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = str(block.get("text") or "")
                    if text:
                        break
        text = text.strip()
        if text:
            return text[:max_len].strip()
    return None


# ---------- list ----------

@router.get("", response_model=ChatListOut)
def list_chats(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Return the user's chats with message counts, newest first.

    Uses a correlated subquery for message_count rather than loading
    messages into memory and calling len(). Hits the
    ix_chats_user_updated composite index for the user filter + sort.
    """
    msg_count_subq = (
        select(func.count(ChatMessage.id))
        .where(ChatMessage.chat_id == Chat.id)
        .correlate(Chat)
        .scalar_subquery()
    )

    rows = (
        db.query(
            Chat.id,
            Chat.title,
            Chat.created_at,
            Chat.updated_at,
            msg_count_subq.label("message_count"),
        )
        .filter(Chat.user_id == user.id)
        .order_by(Chat.updated_at.desc())
        .all()
    )

    items = [
        ChatListItem(
            id=r.id,
            title=r.title,
            created_at=r.created_at,
            updated_at=r.updated_at,
            message_count=r.message_count or 0,
        )
        for r in rows
    ]
    return ChatListOut(chats=items)


# ---------- create ----------

@router.post("", response_model=ChatDetail, status_code=status.HTTP_201_CREATED)
def create_chat(
    payload: ChatCreateIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Create an empty chat. Idempotent on `id`:
      - If client supplies id and it already belongs to this user,
        we return the existing chat instead of erroring. Lets the
        frontend safely POST whenever it transitions from "empty
        local state" to "the user just typed something."
      - If id belongs to another user, 404 (don't leak existence).
      - If id is absent, we generate one.
    """
    chat_id = payload.id or _generate_chat_id()

    existing = db.query(Chat).filter(Chat.id == chat_id).first()
    if existing:
        if existing.user_id != user.id:
            # Don't reveal that the id is in use by someone else
            raise HTTPException(status_code=404, detail="Chat not found")
        # Idempotent: return the existing chat
        return ChatDetail(
            id=existing.id,
            title=existing.title,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
            messages=[
                ChatMessageOut(
                    role=m.role,
                    content=m.content,
                    position=m.position,
                    created_at=m.created_at,
                )
                for m in existing.messages
            ],
        )

    chat = Chat(
        id=chat_id,
        user_id=user.id,
        title=payload.title,
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)

    logger.info("create_chat user=%s chat_id=%s", user.id, chat.id)

    return ChatDetail(
        id=chat.id,
        title=chat.title,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[],
    )


# ---------- get one ----------

@router.get("/{chat_id}", response_model=ChatDetail)
def get_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    chat = _get_user_chat(db, user.id, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    return ChatDetail(
        id=chat.id,
        title=chat.title,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[
            ChatMessageOut(
                role=m.role,
                content=m.content,
                position=m.position,
                created_at=m.created_at,
            )
            for m in chat.messages
        ],
    )


# ---------- update (rename) ----------

@router.patch("/{chat_id}", response_model=ChatDetail)
def update_chat(
    chat_id: str,
    payload: ChatUpdateIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    chat = _get_user_chat(db, user.id, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if payload.title is not None:
        chat.title = payload.title.strip() or None

    db.commit()
    db.refresh(chat)

    return ChatDetail(
        id=chat.id,
        title=chat.title,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[
            ChatMessageOut(
                role=m.role,
                content=m.content,
                position=m.position,
                created_at=m.created_at,
            )
            for m in chat.messages
        ],
    )


# ---------- delete ----------

@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    chat = _get_user_chat(db, user.id, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    db.delete(chat)
    db.commit()
    logger.info("delete_chat user=%s chat_id=%s", user.id, chat_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- replace messages (the core save endpoint) ----------

@router.put("/{chat_id}/messages", response_model=MessagesReplaceOut)
def replace_messages(
    chat_id: str,
    payload: MessagesReplaceIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Replace the entire message list for this chat. Atomic — either
    all old messages get deleted and all new ones inserted, or nothing
    changes.

    The client always has the canonical conversation state (the agent
    loop returns the full history every turn). PUT just persists that
    canonical state. Idempotent on identical payloads.

    Side effect: if chat.title is currently NULL and the new payload
    contains a user message, we auto-derive a title from the first
    60 chars of that message. We never overwrite a non-null title
    here — that's only changed by PATCH.
    """
    chat = _get_user_chat(db, user.id, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # Delete existing messages, flush, then bulk insert. Single transaction.
    db.query(ChatMessage).filter(ChatMessage.chat_id == chat_id).delete(
        synchronize_session=False
    )
    db.flush()

    new_rows = [
        ChatMessage(
            chat_id=chat_id,
            position=i,
            role=m.role,
            content=m.content,
        )
        for i, m in enumerate(payload.messages)
    ]
    if new_rows:
        db.add_all(new_rows)

    # Auto-derive title only if we don't have one yet
    if chat.title is None:
        derived = _derive_title(payload.messages)
        if derived:
            chat.title = derived

    # SQLAlchemy onupdate handles updated_at. We touch the column
    # explicitly to make sure it advances even if SQLAlchemy doesn't
    # think anything on `chats` changed.
    chat.updated_at = func.now()

    db.commit()
    db.refresh(chat)

    logger.info(
        "replace_messages user=%s chat_id=%s count=%d title_set=%s",
        user.id, chat_id, len(payload.messages), chat.title is not None,
    )

    return MessagesReplaceOut(
        message_count=len(payload.messages),
        updated_at=chat.updated_at,
        title=chat.title,
    )