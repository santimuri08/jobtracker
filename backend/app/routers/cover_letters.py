# backend/app/routers/cover_letters.py
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Application, CoverLetter, ResumeParse
from app.schemas import (
    CoverLetterGenerateIn,
    CoverLetterOut,
    CoverLetterUpdate,
)
from app.services.cover_letter import run_cover_letter

router = APIRouter(
    prefix="/api/v1/applications/{application_id}/cover-letters",
    tags=["cover_letters"],
)


def _get_app_or_404(db: Session, app_id: int, user_id: str) -> Application:
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_obj


def _resume_parse_dict(parse: ResumeParse) -> dict:
    """Build the slim dict we send to Claude — no raw_text, no DB metadata."""
    return {
        "full_name": parse.full_name,
        "email": parse.email,
        "phone": parse.phone,
        "location": parse.location,
        "linkedin_url": parse.linkedin_url,
        "github_url": parse.github_url,
        "summary": parse.summary,
        "skills": parse.skills or [],
        "work_experience": parse.work_experience or [],
        "education": parse.education or [],
    }


@router.get("", response_model=List[CoverLetterOut])
def list_cover_letters(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    return (
        db.query(CoverLetter)
        .filter(CoverLetter.application_id == application_id)
        .order_by(CoverLetter.created_at.desc())
        .all()
    )


@router.post("", response_model=CoverLetterOut, status_code=201)
def generate_cover_letter(
    application_id: int,
    payload: CoverLetterGenerateIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app_obj = _get_app_or_404(db, application_id, user.id)

    # Validate inputs
    if not app_obj.job_description:
        raise HTTPException(
            status_code=400,
            detail="Application has no job description. Add one before generating.",
        )
    if not app_obj.resume_id:
        raise HTTPException(
            status_code=400,
            detail="Application has no linked resume. Link one before generating.",
        )

    parse = (
        db.query(ResumeParse)
        .filter(ResumeParse.resume_id == app_obj.resume_id)
        .first()
    )
    if not parse:
        raise HTTPException(
            status_code=400,
            detail="Linked resume has not been parsed yet. Parse it first.",
        )

    # Call Claude
    try:
        result = run_cover_letter(
            resume_parse=_resume_parse_dict(parse),
            job_description=app_obj.job_description,
            company=app_obj.company,
            role=app_obj.role,
            tone=payload.tone,
            extra_instructions=payload.extra_instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")

    content = (result.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="AI returned empty cover letter")

    # First cover letter for this app becomes active automatically;
    # later ones do not auto-steal active.
    existing_count = (
        db.query(CoverLetter)
        .filter(CoverLetter.application_id == application_id)
        .count()
    )
    is_active = existing_count == 0
    label = f"Draft {existing_count + 1}"

    obj = CoverLetter(
        application_id=application_id,
        content=content,
        version_label=label,
        is_active=is_active,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{letter_id}", response_model=CoverLetterOut)
def get_cover_letter(
    application_id: int,
    letter_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = (
        db.query(CoverLetter)
        .filter(
            CoverLetter.id == letter_id,
            CoverLetter.application_id == application_id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    return obj


@router.patch("/{letter_id}", response_model=CoverLetterOut)
def update_cover_letter(
    application_id: int,
    letter_id: int,
    payload: CoverLetterUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = (
        db.query(CoverLetter)
        .filter(
            CoverLetter.id == letter_id,
            CoverLetter.application_id == application_id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    data = payload.model_dump(exclude_unset=True)

    # If they're setting this one active, clear is_active on others first
    if data.get("is_active") is True:
        (
            db.query(CoverLetter)
            .filter(
                CoverLetter.application_id == application_id,
                CoverLetter.id != letter_id,
            )
            .update({"is_active": False}, synchronize_session=False)
        )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{letter_id}", status_code=204)
def delete_cover_letter(
    application_id: int,
    letter_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    obj = (
        db.query(CoverLetter)
        .filter(
            CoverLetter.id == letter_id,
            CoverLetter.application_id == application_id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    db.delete(obj)
    db.commit()
    return None