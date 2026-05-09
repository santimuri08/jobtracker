# backend/app/services/email_sender.py
"""
Thin wrapper around Resend's Python SDK.

Every email send goes through this module. Centralizes:
  - API key handling
  - From-address default
  - Logging
"""
from __future__ import annotations

import logging

import resend

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(*, to: str, subject: str, html: str) -> dict:
    """
    Send a single transactional email via Resend.

    Raises:
        RuntimeError: if RESEND_API_KEY is unset.
        Exception:    for any Resend API failure.
    """
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY is not set")

    resend.api_key = settings.resend_api_key

    params: resend.Emails.SendParams = {
        "from": settings.resend_from_email,
        "to": [to],
        "subject": subject,
        "html": html,
    }

    result = resend.Emails.send(params)
    logger.info("resend send to=%s subject=%r id=%s", to, subject, result.get("id"))
    return result