# backend/app/routers/reminders.py
"""
Reminders router.

5 endpoints under /api/v1/reminders:
  GET    /                   list, with ?status=pending|completed|overdue|due_soon, ?application_id=N
  POST   /                   create
  GET    /{reminder_id}      detail
  PATCH  /{reminder_id}      update (message, due_at, application_id, completed)
  DELETE /{reminder_id}      delete

Scope is enforced by user_id from the JWT — same isolation guarantee as
every other router in the app.
"""
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Application, Reminder
from app.schemas import ReminderCreate, ReminderOut, ReminderUpdate

router = APIRouter(prefix="/api/v1/reminders", tags=["reminders"])


def _get_user_reminder(db: Session, user_id: str, reminder_id: int) -> Reminder | None:
    return (
        db.query(Reminder)
        .filter(Reminder.id == reminder_id, Reminder.user_id == user_id)
        .first()
    )


def _validate_application(db: Session, user_id: str, application_id: int) -> None:
    """Raise 404 if the application doesn't exist OR isn't owned by this user."""
    exists = (
        db.query(Application.id)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Application not found")


@router.get("", response_model=List[ReminderOut])
def list_reminders(
    status: str | None = Query(None, description="pending | completed | overdue | due_soon"),
    application_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    List reminders for the current user.

    Status filters:
      - pending: completed_at IS NULL
      - completed: completed_at IS NOT NULL
      - overdue: completed_at IS NULL AND due_at < now
      - due_soon: completed_at IS NULL AND due_at within next 7 days
    """
    q = db.query(Reminder).filter(Reminder.user_id == user.id)

    if application_id is not None:
        q = q.filter(Reminder.application_id == application_id)

    now = datetime.now(timezone.utc)
    if status == "pending":
        q = q.filter(Reminder.completed_at.is_(None))
    elif status == "completed":
        q = q.filter(Reminder.completed_at.is_not(None))
    elif status == "overdue":
        q = q.filter(Reminder.completed_at.is_(None), Reminder.due_at < now)
    elif status == "due_soon":
        q = q.filter(
            Reminder.completed_at.is_(None),
            Reminder.due_at >= now,
            Reminder.due_at < now + timedelta(days=7),
        )
    elif status is not None:
        raise HTTPException(
            status_code=400,
            detail="status must be one of: pending, completed, overdue, due_soon",
        )

    return q.order_by(Reminder.due_at.asc()).all()


@router.post("", response_model=ReminderOut, status_code=201)
def create_reminder(
    payload: ReminderCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if payload.application_id is not None:
        _validate_application(db, user.id, payload.application_id)

    obj = Reminder(
        user_id=user.id,
        application_id=payload.application_id,
        message=payload.message.strip(),
        due_at=payload.due_at,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{reminder_id}", response_model=ReminderOut)
def get_reminder(
    reminder_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    obj = _get_user_reminder(db, user.id, reminder_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return obj


@router.patch("/{reminder_id}", response_model=ReminderOut)
def update_reminder(
    reminder_id: int,
    payload: ReminderUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    obj = _get_user_reminder(db, user.id, reminder_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Reminder not found")

    data = payload.model_dump(exclude_unset=True)

    # If client wants to change application_id, validate ownership
    if "application_id" in data and data["application_id"] is not None:
        _validate_application(db, user.id, data["application_id"])

    # Handle completion toggling via the synthetic `completed` field
    if "completed" in data:
        completed = data.pop("completed")
        if completed is True and obj.completed_at is None:
            obj.completed_at = datetime.now(timezone.utc)
        elif completed is False:
            obj.completed_at = None

    if "message" in data and data["message"] is not None:
        if not data["message"].strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        data["message"] = data["message"].strip()

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(
    reminder_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    obj = _get_user_reminder(db, user.id, reminder_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Reminder not found")
    db.delete(obj)
    db.commit()
    return None