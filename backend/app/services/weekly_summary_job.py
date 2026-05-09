# backend/app/services/weekly_summary_job.py
"""
The orchestrator for the weekly summary feature.

`run_for_user(db, user)`:
  1. Loads the user's email preference (creates one if missing).
  2. Skips if frequency=off or last_sent_at < 6 days ago.
  3. Collects the user's last-7-day stats.
  4. Calls Claude via run_weekly_summary().
  5. Renders HTML via render_weekly_summary_html().
  6. Sends via send_email().
  7. Updates last_sent_at.
  Returns a dict describing what happened.

`run_for_all_users(db)`:
  Iterates every user in the DB and calls run_for_user, returning aggregate stats.
  Logs a row to scheduled_job_runs at the end.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Application,
    EmailPreference,
    InterviewRound,
    InterviewOutcome,
    ScheduledJobRun,
    User,
)
from app.services.email_sender import send_email
from app.services.email_template import render_weekly_summary_html
from app.services.weekly_summary import run_weekly_summary

logger = logging.getLogger(__name__)

JOB_NAME = "weekly_summary"
MIN_DAYS_BETWEEN_SENDS = 6   # so a manual trigger doesn't double-send


def _get_or_create_pref(db: Session, user: User) -> EmailPreference:
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref:
        return pref
    pref = EmailPreference(
        user_id=user.id,
        frequency="weekly",
        unsubscribe_token=secrets.token_urlsafe(24),
    )
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return pref


def _collect_stats(db: Session, user: User, since: datetime) -> dict[str, Any]:
    """Gather everything we want to feed into the prompt."""
    apps = (
        db.query(Application)
        .filter(Application.user_id == user.id)
        .all()
    )
    new_apps = [a for a in apps if a.created_at >= since]
    applied_this_week = [
        a for a in apps if a.applied_date and a.applied_date >= since.date()
    ]

    by_status: dict[str, int] = {}
    for a in apps:
        key = a.status.value
        by_status[key] = by_status.get(key, 0) + 1

    upcoming_rounds = (
        db.query(InterviewRound, Application)
        .join(Application, InterviewRound.application_id == Application.id)
        .filter(Application.user_id == user.id)
        .filter(InterviewRound.scheduled_at.is_not(None))
        .filter(InterviewRound.scheduled_at >= datetime.now(timezone.utc))
        .filter(InterviewRound.outcome == InterviewOutcome.pending)
        .order_by(InterviewRound.scheduled_at.asc())
        .limit(5)
        .all()
    )

    return {
        "totals": {
            "all_applications": len(apps),
            "by_status": by_status,
        },
        "this_week": {
            "new_applications": [
                {
                    "company": a.company,
                    "role": a.role,
                    "status": a.status.value,
                }
                for a in new_apps
            ],
            "applied_count": len(applied_this_week),
            "applied": [
                {"company": a.company, "role": a.role}
                for a in applied_this_week
            ],
        },
        "upcoming_interviews": [
            {
                "company": app.company,
                "role": app.role,
                "type": rnd.type.value,
                "scheduled_at": rnd.scheduled_at.isoformat(),
            }
            for rnd, app in upcoming_rounds
        ],
    }


def run_for_user(
    db: Session, user: User, *, force: bool = False, override_to: str | None = None
) -> dict[str, Any]:
    """
    Run the weekly summary for one user.

    `force=True` ignores frequency=off and the 6-day cooldown (used by the
    manual trigger button).
    `override_to` lets the manual trigger redirect mail to EMAIL_TEST_RECIPIENT
    while Resend is on the sandbox domain.
    """
    pref = _get_or_create_pref(db, user)

    if not force and pref.frequency != "weekly":
        return {"sent": False, "skipped_reason": "frequency_off"}

    if not force and pref.last_sent_at:
        cooldown = datetime.now(timezone.utc) - pref.last_sent_at
        if cooldown < timedelta(days=MIN_DAYS_BETWEEN_SENDS):
            return {"sent": False, "skipped_reason": "recently_sent"}

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=7)
    stats = _collect_stats(db, user, since)

    week_ending = now.strftime("%B %-d, %Y")

    # Generate the body via Claude
    result = run_weekly_summary(stats, week_ending=week_ending)
    subject = (result.get("subject") or "Your JobTrackr weekly summary")[:78]
    preheader = result.get("preheader") or "Your job-search recap for the week."
    summary_html = result.get("summary_html") or "<p>No update available this week.</p>"
    suggestions = result.get("suggestions") or []
    if not isinstance(suggestions, list):
        suggestions = []

    unsubscribe_url = (
        f"http://localhost:3000/unsubscribe?token={pref.unsubscribe_token}"
    )

    html = render_weekly_summary_html(
        user_name=user.name,
        preheader=preheader,
        summary_html=summary_html,
        suggestions=suggestions[:3],
        unsubscribe_url=unsubscribe_url,
        week_ending=week_ending,
    )

    # Resend's sandbox domain only allows sending TO the address you signed up with.
    # `override_to` lets the manual trigger redirect there for testing.
    to_address = override_to or user.email

    send_email(to=to_address, subject=subject, html=html)

    pref.last_sent_at = now
    db.commit()

    return {
        "sent": True,
        "email_to": to_address,
        "summary_preview": (summary_html[:200] + "...") if len(summary_html) > 200 else summary_html,
    }


def run_for_all_users(db: Session) -> dict[str, Any]:
    """The scheduled batch run. Called by APScheduler every Monday."""
    started = datetime.now(timezone.utc)
    processed = 0
    sent = 0
    errors: list[str] = []

    users = db.query(User).all()
    for u in users:
        processed += 1
        try:
            result = run_for_user(db, u, force=False)
            if result.get("sent"):
                sent += 1
        except Exception as e:  # noqa: BLE001
            errors.append(f"{u.email}: {e}")
            logger.exception("weekly_summary failed for user=%s", u.email)

    finished = datetime.now(timezone.utc)
    status = "success" if not errors else "error"

    log_row = ScheduledJobRun(
        job_name=JOB_NAME,
        status=status,
        started_at=started,
        finished_at=finished,
        duration_ms=int((finished - started).total_seconds() * 1000),
        users_processed=processed,
        emails_sent=sent,
        error_message="\n".join(errors)[:5000] if errors else None,
    )
    db.add(log_row)
    db.commit()

    logger.info(
        "weekly_summary batch processed=%d sent=%d errors=%d", processed, sent, len(errors)
    )
    return {
        "processed": processed,
        "sent": sent,
        "errors": len(errors),
    }