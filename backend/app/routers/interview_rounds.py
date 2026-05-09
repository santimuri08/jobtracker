# backend/app/routers/interview_rounds.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application, InterviewRound
from app.schemas import InterviewRoundCreate, InterviewRoundUpdate, InterviewRoundOut

router = APIRouter(prefix="/api/v1/applications/{application_id}/rounds", tags=["interview_rounds"])


def _get_app_or_404(db: Session, app_id: int, user_id: str) -> Application:
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_obj


@router.get("", response_model=List[InterviewRoundOut])
def list_rounds(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    return (
        db.query(InterviewRound)
        .filter(InterviewRound.application_id == application_id)
        .order_by(InterviewRound.round_number.asc())
        .all()
    )


@router.post("", response_model=InterviewRoundOut, status_code=201)
def create_round(
    application_id: int,
    payload: InterviewRoundCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = InterviewRound(**payload.model_dump(), application_id=application_id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch("/{round_id}", response_model=InterviewRoundOut)
def update_round(
    application_id: int,
    round_id: int,
    payload: InterviewRoundUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = (
        db.query(InterviewRound)
        .filter(InterviewRound.id == round_id, InterviewRound.application_id == application_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Round not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{round_id}", status_code=204)
def delete_round(
    application_id: int,
    round_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = (
        db.query(InterviewRound)
        .filter(InterviewRound.id == round_id, InterviewRound.application_id == application_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Round not found")
    db.delete(obj)
    db.commit()