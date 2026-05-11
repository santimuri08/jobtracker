# backend/app/routers/gap_analyses.py
from typing import Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Application, GapAnalysis, ResumeParse
from app.schemas import GapAnalysisOut
from app.services.gap_analysis import run_gap_analysis

router = APIRouter(
    prefix="/api/v1/applications/{application_id}/gap-analysis",
    tags=["gap-analysis"],
)


def _get_app_or_404(db: Session, app_id: int, user_id: str) -> Application:
    app = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


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
        assert parse is not None
        return app_obj, parse

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


@router.post("", response_model=GapAnalysisOut)
def create_gap_analysis(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    app = _get_app_or_404(db, application_id, user.id)
    app, parse = _check_application_ready(db, app, feature="gap_analysis")

    # Build the dict we send to Claude — only the user-visible parsed fields,
    # not raw_text or DB metadata
    resume_dict = {
        "full_name": parse.full_name,
        "email": parse.email,
        "phone": parse.phone,
        "location": parse.location,
        "summary": parse.summary,
        "skills": parse.skills,
        "work_experience": parse.work_experience,
        "education": parse.education,
    }

    try:
        result = run_gap_analysis(resume_dict, app.job_description)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gap analysis failed: {e}")

    # Upsert: delete + flush + insert (same pattern as Phase 3 resume parse)
    existing = (
        db.query(GapAnalysis)
        .filter(GapAnalysis.application_id == application_id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    row = GapAnalysis(
        application_id=application_id,
        fit_score=result.get("fit_score"),
        matched_skills=result.get("matched_skills") or [],
        missing_skills=result.get("missing_skills") or [],
        experience_gaps=result.get("experience_gaps") or [],
        recommendations=result.get("recommendations") or [],
        summary=result.get("summary"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("", response_model=GapAnalysisOut)
def get_gap_analysis(
    application_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _get_app_or_404(db, application_id, user.id)
    row = (
        db.query(GapAnalysis)
        .filter(GapAnalysis.application_id == application_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="No gap analysis yet")
    return row