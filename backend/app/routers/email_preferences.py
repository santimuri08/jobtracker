# backend/app/routers/email_preferences.py
"""
Endpoints:
  GET    /api/v1/email-preferences          — read your own prefs
  PATCH  /api/v1/email-preferences          — update frequency
  POST   /api/v1/email-preferences/test     — manual trigger; sends a real email
  POST   /api/v1/unsubscribe                — public; sets frequency=off via token
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models import EmailPreference, User
from app.schemas import (
    EmailPreferenceOut,
    EmailPreferenceUpdate,
    TriggerWeeklySummaryOut,
)
from app.services.weekly_summary_job import run_for_user

router = APIRouter(prefix="/api/v1", tags=["email_preferences"])


def _get_or_create_pref(db: Session, user_id: str) -> EmailPreference:
    pref = (
        db.query(EmailPreference)
        .filter(EmailPreference.user_id == user_id)
        .first()
    )
    if pref:
        return pref
    pref = EmailPreference(
        user_id=user_id,
        frequency="weekly",
        unsubscribe_token=secrets.token_urlsafe(24),
    )
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return pref


@router.get("/email-preferences", response_model=EmailPreferenceOut)
def get_my_preferences(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    pref = _get_or_create_pref(db, user.id)
    return pref


@router.patch("/email-preferences", response_model=EmailPreferenceOut)
def update_my_preferences(
    payload: EmailPreferenceUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if payload.frequency not in ("weekly", "off"):
        raise HTTPException(status_code=400, detail="frequency must be 'weekly' or 'off'")

    pref = _get_or_create_pref(db, user.id)
    pref.frequency = payload.frequency
    db.commit()
    db.refresh(pref)
    return pref


@router.post("/email-preferences/test", response_model=TriggerWeeklySummaryOut)
def trigger_weekly_summary_now(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Manually trigger the weekly summary for the current user, ignoring
    frequency and cooldown. Sends to EMAIL_TEST_RECIPIENT if it's set,
    otherwise to the user's own email. (Resend's sandbox domain only
    delivers to the address you signed up with.)
    """
    db_user = db.query(User).filter(User.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    override = settings.email_test_recipient or None

    try:
        result = run_for_user(db, db_user, force=True, override_to=override)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Send failed: {e}")

    return TriggerWeeklySummaryOut(**result)


# ---- Public unsubscribe endpoint ----

class UnsubscribeIn(BaseModel):
    token: str


class UnsubscribeOut(BaseModel):
    ok: bool


@router.post("/unsubscribe", response_model=UnsubscribeOut)
def unsubscribe(payload: UnsubscribeIn, db: Session = Depends(get_db)):
    pref = (
        db.query(EmailPreference)
        .filter(EmailPreference.unsubscribe_token == payload.token)
        .first()
    )
    if not pref:
        raise HTTPException(status_code=404, detail="Invalid token")
    pref.frequency = "off"
    db.commit()
    return UnsubscribeOut(ok=True)