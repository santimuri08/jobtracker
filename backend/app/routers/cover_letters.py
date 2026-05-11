# backend/app/routers/cover_letters.py
from typing import List, Tuple

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


def _check_application_ready(
    db: Session, app_obj: Application, *, feature: str
) -> Tuple[Application, ResumeParse]:
    """
    Validate that an application has everything required for an AI feature
    that needs the job description + a parsed resume.

    Returns (app, parse) on success.
    Raises HTTPException(400, detail={...}) with a structured body listing
    every missing requirement, so the frontend and chat agent can render
    actionable next steps instead of a flat error string.
    """
    missing: list[str] = []

    if not app_obj.job_description or not app_obj.job_description.strip():
        missing.append("job_description")

    parse: ResumeParse | None = None
    if not app_obj.resume_id:
        missing.append("linked_resume")
        # Without a resume_id we can't even look up a parse, so mark both.
        missing.append("parsed_resume")
    else:
        parse = (
            db.query(ResumeParse)
            .filter(ResumeParse.resume_id == app_obj.resume_id)
            .first()
        )
        if not parse:
            missing.append("parsed_resume")

    if not missing:
        # mypy/runtime: parse is guaranteed non-None when no requirements are missing.
        assert parse is not None
        return app_obj, parse

    # Build the human-readable message
    label_map = {
        "job_description": "a job description",
        "linked_resume": "a linked resume",
        "parsed_resume": "a parsed resume",
    }
    pretty = [label_map[m] for m in missing if m in label_map]
    if len(pretty) == 1:
        joined = pretty[0]
    elif len(pretty) == 2:
        joined = f"{pretty[0]} and {pretty[1]}"
    else:
        joined = ", ".join(pretty[:-1]) + f", and {pretty[-1]}"

    message = (
        f"This application needs {joined} before you can "
        f"{'generate a cover letter' if feature == 'cover_letter' else 'run gap analysis'}."
    )

    # Build suggested follow-up actions for the UI / agent
    actions = []
    if "job_description" in missing:
        actions.append({
            "label": "Add job description",
            "kind": "add_job_description",
            "application_id": app_obj.id,
        })
    if "linked_resume" in missing:
        actions.append({
            "label": "Link a resume",
            "kind": "link_resume",
            "application_id": app_obj.id,
        })
    if "parsed_resume" in missing and "linked_resume" not in missing:
        # Resume IS linked but unparsed — offer a parse retry, not link
        actions.append({
            "label": "Parse the linked resume",
            "kind": "parse_resume",
            "application_id": app_obj.id,
            "resume_id": app_obj.resume_id,
        })

    raise HTTPException(
        status_code=400,
        detail={
            "error": "missing_requirements",
            "feature": feature,
            "missing": missing,
            "message": message,
            "actions": actions,
        },
    )


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
    app_obj, parse = _check_application_ready(db, app_obj, feature="cover_letter")

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