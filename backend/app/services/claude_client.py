# backend/app/services/claude_client.py
"""
Thin wrapper around the Anthropic SDK.

Every AI feature (gap analysis, interview prep, resume tailoring, ...)
goes through this module instead of calling the SDK directly. Centralizes:
  - API key handling
  - JSON-mode response parsing (with code-fence stripping)
  - Token usage / cost logging
  - Easy mocking in tests

Usage:
    from app.services.claude_client import call_claude_json
    data = call_claude_json(
        system="You are a JSON-emitting tool.",
        user="Here is the input...",
        max_tokens=2048,
    )
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from anthropic import Anthropic

from app.config import settings

logger = logging.getLogger(__name__)

# Approximate cost per 1M tokens for claude-sonnet-4-5 (USD).
# Update if pricing changes — these are only used for the local log line.
COST_INPUT_PER_MTOK = 3.0
COST_OUTPUT_PER_MTOK = 15.0

DEFAULT_MODEL = "claude-sonnet-4-5"


def _strip_code_fences(raw: str) -> str:
    """Claude occasionally wraps JSON in ```json ... ``` despite instructions."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    # Trim a trailing fence if any
    if raw.endswith("```"):
        raw = raw[:-3].strip()
    return raw


def call_claude_json(
    *,
    system: str,
    user: str,
    max_tokens: int = 2048,
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """
    Send a prompt to Claude and parse the response as JSON.

    Raises:
        RuntimeError: if ANTHROPIC_API_KEY is unset.
        ValueError:   if Claude's response can't be parsed as JSON.
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=settings.anthropic_api_key)

    started = time.monotonic()
    message = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    elapsed_ms = int((time.monotonic() - started) * 1000)

    # Token / cost logging
    usage = getattr(message, "usage", None)
    if usage is not None:
        in_tok = getattr(usage, "input_tokens", 0) or 0
        out_tok = getattr(usage, "output_tokens", 0) or 0
        cost = (in_tok / 1_000_000) * COST_INPUT_PER_MTOK + (
            out_tok / 1_000_000
        ) * COST_OUTPUT_PER_MTOK
        logger.info(
            "claude call model=%s in_tok=%d out_tok=%d cost_usd=%.4f elapsed_ms=%d",
            model,
            in_tok,
            out_tok,
            cost,
            elapsed_ms,
        )

    raw = message.content[0].text
    cleaned = _strip_code_fences(raw)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        # Surface enough context to debug without dumping the whole reply
        snippet = cleaned[:200]
        raise ValueError(
            f"Claude returned non-JSON output: {e}. First 200 chars: {snippet!r}"
        ) from e