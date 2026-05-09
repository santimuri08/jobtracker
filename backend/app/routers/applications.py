# backend/app/routers/applications.py
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func
from typing import Optional, List

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application, ApplicationStatus
from app.schemas import (
    ApplicationCreate, ApplicationUpdate, ApplicationOut,
    ApplicationDetailOut, PipelineSummary,
)
from app.services.embeddings import build_application_text, embed_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/applications", tags=["applications"])


def _maybe_embed(app_obj: Application) -> None:
    """
    Set app_obj.embedding from the current text fields, IF there's enough text.
    No-op if the application has no job_description (we don't embed shells).
    Errors are swallowed with a log line — embedding failures must not break save.
    """
    if not app_obj.job_description or not app_obj.job_description.strip():
        app_obj.embedding = None
        return

    text = build_application_text(
        company=app_obj.company,
        role=app_obj.role,
        location=app_obj.location,
        job_description=app_obj.job_description,
    )
    try:
        app_obj.embedding = embed_document(text)
    except Exception as e:
        # Don't fail the save just because the embedding service had a hiccup.
        logger.warning("Embedding generation failed for app id=%s: %s", app_obj.id, e)
        app_obj.embedding = None


@router.get("", response_model=List[ApplicationOut])
def list_applications(
    status: Optional[ApplicationStatus] = None,
    company: Optional[str] = None,
    sort: str = Query("created_at_desc"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    q = db.query(Application).filter(Application.user_id == user.id)

    if status:
        q = q.filter(Application.status == status)
    if company:
        q = q.filter(Application.company.ilike(f"%{company}%"))

    sort_map = {
        "created_at_desc": Application.created_at.desc(),
        "created_at_asc": Application.created_at.asc(),
        "company_asc": Application.company.asc(),
        "applied_date_desc": Application.applied_date.desc(),
    }
    q = q.order_by(sort_map.get(sort, Application.created_at.desc()))

    return q.all()


@router.get("/summary", response_model=PipelineSummary)
def pipeline_summary(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    rows = (
        db.query(Application.status, func.count(Application.id))
        .filter(Application.user_id == user.id)
        .group_by(Application.status)
        .all()
    )
    summary = PipelineSummary()
    for status, count in rows:
        setattr(summary, status.value, count)
    summary.total = sum(count for _, count in rows)
    return summary


@router.post("", response_model=ApplicationOut, status_code=201)
def create_application(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app_obj = Application(**payload.model_dump(), user_id=user.id)
    _maybe_embed(app_obj)
    db.add(app_obj)
    db.commit()
    db.refresh(app_obj)
    return app_obj


@router.get("/{application_id}", response_model=ApplicationDetailOut)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app_obj = (
        db.query(Application)
        .options(
            selectinload(Application.interview_rounds),
            selectinload(Application.contacts),
            selectinload(Application.notes),
            selectinload(Application.resume),
        )
        .filter(Application.id == application_id, Application.user_id == user.id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_obj


@router.patch("/{application_id}", response_model=ApplicationOut)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app_obj = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user.id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")

    data = payload.model_dump(exclude_unset=True)
    text_fields = {"company", "role", "location", "job_description"}
    text_changed = any(k in data for k in text_fields)

    for field, value in data.items():
        setattr(app_obj, field, value)

    # If any of the embeddable fields changed, re-embed.
    if text_changed:
        _maybe_embed(app_obj)

    db.commit()
    db.refresh(app_obj)
    return app_obj


@router.delete("/{application_id}", status_code=204)
def delete_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app_obj = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user.id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    db.delete(app_obj)
    db.commit()