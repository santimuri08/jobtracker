# backend/app/services/embeddings.py
"""
Thin wrapper around the Voyage AI embeddings SDK.

Used by the application semantic-search feature. Centralizes:
  - API key handling
  - Model + dimension constants
  - Batch handling

Anthropic does not provide embeddings; Voyage is their recommended partner.
"""
from __future__ import annotations

import logging
from typing import Iterable

import voyageai

from app.config import settings

logger = logging.getLogger(__name__)

# voyage-3-large -> 1024 dims; good general-purpose retrieval model.
EMBEDDING_MODEL = "voyage-3-large"
EMBEDDING_DIM = 1024


def _client() -> voyageai.Client:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set")
    return voyageai.Client(api_key=settings.voyage_api_key)


def embed_document(text: str) -> list[float]:
    """Embed a single piece of text as a 'document' (the thing being searched)."""
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")
    client = _client()
    result = client.embed(
        texts=[text.strip()],
        model=EMBEDDING_MODEL,
        input_type="document",
    )
    vec = result.embeddings[0]
    logger.info(
        "voyage embed model=%s input_type=document chars=%d",
        EMBEDDING_MODEL, len(text),
    )
    return vec


def embed_query(text: str) -> list[float]:
    """Embed a single piece of text as a 'query' (the thing we're searching with)."""
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")
    client = _client()
    result = client.embed(
        texts=[text.strip()],
        model=EMBEDDING_MODEL,
        input_type="query",
    )
    vec = result.embeddings[0]
    logger.info(
        "voyage embed model=%s input_type=query chars=%d",
        EMBEDDING_MODEL, len(text),
    )
    return vec


def embed_documents_batch(texts: Iterable[str]) -> list[list[float]]:
    """Embed many documents at once. Used by the backfill script."""
    cleaned = [t.strip() for t in texts if t and t.strip()]
    if not cleaned:
        return []
    client = _client()
    result = client.embed(
        texts=cleaned,
        model=EMBEDDING_MODEL,
        input_type="document",
    )
    logger.info(
        "voyage embed batch model=%s input_type=document n=%d",
        EMBEDDING_MODEL, len(cleaned),
    )
    return list(result.embeddings)


def build_application_text(
    company: str | None,
    role: str | None,
    location: str | None,
    job_description: str | None,
) -> str:
    """
    Build the canonical text we embed per application.
    Keep this consistent across save and backfill so vectors are comparable.
    """
    parts = []
    if role:
        parts.append(f"Role: {role}")
    if company:
        parts.append(f"Company: {company}")
    if location:
        parts.append(f"Location: {location}")
    if job_description:
        parts.append(f"Description: {job_description}")
    return "\n".join(parts).strip()