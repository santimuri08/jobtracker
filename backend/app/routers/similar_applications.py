# backend/app/routers/similar_applications.py
"""
Semantic-search endpoint: given an application id, return other applications
belonging to the same user that are most similar by job-description embedding.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application

router = APIRouter(
    prefix="/api/v1/applications/{application_id}/similar",
    tags=["similar_applications"],
)


class SimilarApplicationOut(BaseModel):
    id: int
    company: str
    role: str
    location: str | None = None
    status: str
    similarity: float    # 0.0 (orthogonal) .. 1.0 (identical)


@router.get("", response_model=list[SimilarApplicationOut])
def list_similar(
    application_id: int,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    # 1. Source app must exist, belong to this user, and have an embedding.
    source = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user.id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=404, detail="Application not found")
    if source.embedding is None:
        raise HTTPException(
            status_code=400,
            detail="This application has no embedding yet (add a job description first).",
        )

    # 2. Cosine distance via pgvector's <=> operator.
    #    distance is in [0, 2]; similarity = 1 - distance, clamped to [0, 1].
    distance = Application.embedding.cosine_distance(source.embedding).label("distance")

    rows = (
        db.query(Application, distance)
        .filter(Application.user_id == user.id)
        .filter(Application.id != application_id)
        .filter(Application.embedding.is_not(None))
        .order_by(distance.asc())
        .limit(limit)
        .all()
    )

    out: list[SimilarApplicationOut] = []
    for app_obj, dist in rows:
        sim = max(0.0, min(1.0, 1.0 - float(dist)))
        out.append(
            SimilarApplicationOut(
                id=app_obj.id,
                company=app_obj.company,
                role=app_obj.role,
                location=app_obj.location,
                status=app_obj.status.value,
                similarity=sim,
            )
        )
    return out