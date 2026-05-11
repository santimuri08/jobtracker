# backend/app/routers/agent.py
"""
The chat agent.

POST /api/v1/agent/chat
Body: { "messages": [...full conversation history with the standard
                     Anthropic content-block shape...] }
Returns: { "messages": [...updated history with assistant turns appended...] }

The agent runs a tool-use loop:
  1. Send conversation + tool definitions to Claude.
  2. If Claude emits a tool_use block, execute the tool against the
     existing routers' logic (using the authenticated user's id), send
     the tool_result back, loop.
  3. When Claude returns a plain text block (no tool_use), we stop and
     return the full messages array.

No new database tables. No new dependencies. Every tool maps to one of
the routers built in earlier phases. Scope is enforced by the user id
from `get_current_user`, same isolation guarantee every other endpoint
has.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, date
from typing import Any

from anthropic import Anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models import Application, ApplicationStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


# ---------- request / response shape ----------

class ChatIn(BaseModel):
    messages: list[dict[str, Any]]   # Anthropic-shaped messages


class ChatOut(BaseModel):
    messages: list[dict[str, Any]]   # full updated history


# ---------- system prompt ----------

SYSTEM_PROMPT = """You are JobAgent, an AI assistant that helps users manage their job-search applications.

You can do the following by calling tools:
- Add new applications when the user describes a job they applied to or saved.
- Update an application's status, salary, location, etc.
- Delete an application the user no longer wants to track.
- List the user's applications, optionally filtered by status.
- Give a pipeline summary (how many are saved, applied, interviewing, etc.).

Rules:
- Be concise and friendly, like texting a helpful friend. Never use markdown lists unless you have 3+ items.
- When the user describes a job, extract every field you can (company, role, location, status, salary range, source, job URL, job description if provided).
- The valid statuses are: saved, applied, interviewing, offer, rejected, withdrawn. Default to "applied" if the user says they applied; "saved" if they just bookmarked it; "interviewing" if they have an interview.
- If the user gives you a company but no role (or vice versa), ASK before adding. Don't invent fields.
- After calling a tool, briefly confirm what you did in plain language. Don't repeat the JSON back to them.
- If the user asks something you can't do with your tools (e.g. send an email, scrape a job site), say so honestly and suggest using the dashboard."""


# ---------- tool definitions for Claude ----------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "add_application",
        "description": "Add a new job application to the user's tracker. Use when the user says they applied to or saved a job.",
        "input_schema": {
            "type": "object",
            "properties": {
                "company": {"type": "string", "description": "Company name."},
                "role": {"type": "string", "description": "Job title."},
                "location": {"type": "string", "description": "Location (city, remote, hybrid, etc.)."},
                "job_url": {"type": "string", "description": "Posting URL if mentioned."},
                "job_description": {"type": "string", "description": "Full job description text if the user pasted it."},
                "salary_min": {"type": "number"},
                "salary_max": {"type": "number"},
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"],
                    "description": "Default to 'applied' if the user says they applied."
                },
                "applied_date": {"type": "string", "description": "ISO date (YYYY-MM-DD) if mentioned."},
                "source": {"type": "string", "description": "Where they found the job (LinkedIn, referral, etc.)."},
            },
            "required": ["company", "role"],
        },
    },
    {
        "name": "list_applications",
        "description": "List the user's applications. Use when they ask 'what apps do I have' or 'show me my pipeline'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"],
                    "description": "Filter by status (optional)."
                },
                "company": {"type": "string", "description": "Filter by company name (substring match)."},
            },
        },
    },
    {
        "name": "pipeline_summary",
        "description": "Get a count of applications grouped by status. Use when the user asks 'what's my pipeline' or 'how many apps do I have'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "update_application",
        "description": "Update fields on an existing application. Use when the user says 'change Figma to interviewing' or similar. Look up the id from list_applications first if needed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer", "description": "The numeric id of the application."},
                "company": {"type": "string"},
                "role": {"type": "string"},
                "location": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]
                },
                "applied_date": {"type": "string", "description": "ISO date."},
                "salary_min": {"type": "number"},
                "salary_max": {"type": "number"},
                "job_description": {"type": "string"},
                "job_url": {"type": "string"},
                "source": {"type": "string"},
            },
            "required": ["application_id"],
        },
    },
    {
        "name": "delete_application",
        "description": "Permanently delete an application. Only do this when the user explicitly asks to delete or remove one.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
            },
            "required": ["application_id"],
        },
    },
]


# ---------- tool executors (talk to the DB the same way the routers do) ----------

def _serialize_app(a: Application) -> dict[str, Any]:
    """Lightweight serializer for tool_results going back to Claude."""
    return {
        "id": a.id,
        "company": a.company,
        "role": a.role,
        "location": a.location,
        "status": a.status.value if a.status else None,
        "applied_date": a.applied_date.isoformat() if a.applied_date else None,
        "salary_min": float(a.salary_min) if a.salary_min is not None else None,
        "salary_max": float(a.salary_max) if a.salary_max is not None else None,
        "source": a.source,
        "job_url": a.job_url,
    }


def _tool_add_application(db: Session, user_id: str, args: dict) -> dict:
    payload = {k: v for k, v in args.items() if v is not None}

    # Coerce date string -> date
    if "applied_date" in payload and isinstance(payload["applied_date"], str):
        try:
            payload["applied_date"] = date.fromisoformat(payload["applied_date"])
        except ValueError:
            del payload["applied_date"]

    # Coerce status string -> enum
    if "status" in payload and isinstance(payload["status"], str):
        try:
            payload["status"] = ApplicationStatus(payload["status"])
        except ValueError:
            payload["status"] = ApplicationStatus.applied
    else:
        payload.setdefault("status", ApplicationStatus.applied)

    app_obj = Application(**payload, user_id=user_id)
    db.add(app_obj)
    db.commit()
    db.refresh(app_obj)
    return {"ok": True, "application": _serialize_app(app_obj)}


def _tool_list_applications(db: Session, user_id: str, args: dict) -> dict:
    q = db.query(Application).filter(Application.user_id == user_id)
    if args.get("status"):
        try:
            q = q.filter(Application.status == ApplicationStatus(args["status"]))
        except ValueError:
            pass
    if args.get("company"):
        q = q.filter(Application.company.ilike(f"%{args['company']}%"))
    rows = q.order_by(Application.created_at.desc()).limit(50).all()
    return {"count": len(rows), "applications": [_serialize_app(a) for a in rows]}


def _tool_pipeline_summary(db: Session, user_id: str, _args: dict) -> dict:
    from sqlalchemy import func
    rows = (
        db.query(Application.status, func.count(Application.id))
        .filter(Application.user_id == user_id)
        .group_by(Application.status)
        .all()
    )
    summary = {s.value: 0 for s in ApplicationStatus}
    for status, count in rows:
        summary[status.value] = count
    summary["total"] = sum(summary.values())
    return summary


def _tool_update_application(db: Session, user_id: str, args: dict) -> dict:
    app_id = args.pop("application_id")
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    # Coerce dates and enums
    if "applied_date" in args and isinstance(args["applied_date"], str):
        try:
            args["applied_date"] = date.fromisoformat(args["applied_date"])
        except ValueError:
            del args["applied_date"]
    if "status" in args and isinstance(args["status"], str):
        try:
            args["status"] = ApplicationStatus(args["status"])
        except ValueError:
            del args["status"]

    for k, v in args.items():
        if v is not None:
            setattr(app_obj, k, v)
    db.commit()
    db.refresh(app_obj)
    return {"ok": True, "application": _serialize_app(app_obj)}


def _tool_delete_application(db: Session, user_id: str, args: dict) -> dict:
    app_id = args["application_id"]
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        return {"ok": False, "error": "Application not found."}
    company = app_obj.company
    db.delete(app_obj)
    db.commit()
    return {"ok": True, "deleted_company": company}


TOOL_EXECUTORS = {
    "add_application": _tool_add_application,
    "list_applications": _tool_list_applications,
    "pipeline_summary": _tool_pipeline_summary,
    "update_application": _tool_update_application,
    "delete_application": _tool_delete_application,
}


# ---------- the loop ----------

def _run_agent_loop(
    db: Session,
    user_id: str,
    messages: list[dict[str, Any]],
    max_iterations: int = 8,
) -> list[dict[str, Any]]:
    """
    Run Claude with tool-use until it returns a final text response.
    Mutates and returns `messages`.
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=settings.anthropic_api_key)

    for _ in range(max_iterations):
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        logger.info(
            "agent turn stop_reason=%s in_tok=%s out_tok=%s",
            response.stop_reason,
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        # Append the assistant's turn verbatim
        assistant_blocks = [block.model_dump() for block in response.content]
        messages.append({"role": "assistant", "content": assistant_blocks})

        # If Claude is done, exit
        if response.stop_reason != "tool_use":
            return messages

        # Otherwise, run every tool_use block and send results back as a user turn
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            tool_name = block.name
            tool_input = block.input or {}
            executor = TOOL_EXECUTORS.get(tool_name)
            try:
                if executor is None:
                    result = {"error": f"Unknown tool: {tool_name}"}
                else:
                    result = executor(db, user_id, dict(tool_input))
            except Exception as e:
                logger.exception("tool %s failed", tool_name)
                result = {"error": f"Tool raised: {type(e).__name__}: {e}"}

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str),
            })

        messages.append({"role": "user", "content": tool_results})

    # Hit the iteration cap — return what we have
    messages.append({
        "role": "assistant",
        "content": [{"type": "text", "text": "I'm having trouble completing that — could you rephrase?"}]
    })
    return messages


# ---------- endpoint ----------

@router.post("/chat", response_model=ChatOut)
def chat(
    payload: ChatIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    try:
        updated = _run_agent_loop(db, user.id, list(payload.messages))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except Exception as e:
        logger.exception("agent loop failed")
        raise HTTPException(status_code=502, detail=f"Agent failed: {e}")

    return {"messages": updated}