# backend/app/routers/resumes.py
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Resume, ResumeParse
from app.schemas import ResumeOut, ResumeParseOut
from app.services.resume_parser import parse_pdf

router = APIRouter(prefix="/api/v1/resumes", tags=["resumes"])

RESUME_STORAGE_ROOT = Path("/data/resumes")
MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_CONTENT_TYPES = {"application/pdf"}


@router.get("", response_model=list[ResumeOut])
def list_resumes(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return (
        db.query(Resume)
        .filter(Resume.user_id == user.id)
        .order_by(Resume.created_at.desc())
        .all()
    )


@router.post("", response_model=ResumeOut, status_code=201)
async def upload_resume(
    label: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    contents = await file.read()
    if len(contents) > MAX_RESUME_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 5 MB limit")
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    user_dir = RESUME_STORAGE_ROOT / user.id
    user_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid.uuid4().hex}.pdf"
    file_path = user_dir / stored_name
    with open(file_path, "wb") as out:
        out.write(contents)

    resume = Resume(
        user_id=user.id,
        label=label,
        filename=file.filename or stored_name,
        file_path=str(file_path),
        content_type=file.content_type,
        size_bytes=len(contents),
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return resume


@router.get("/{resume_id}/download")
def download_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    resume = (
        db.query(Resume)
        .filter(Resume.id == resume_id, Resume.user_id == user.id)
        .first()
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if not os.path.exists(resume.file_path):
        raise HTTPException(status_code=410, detail="File missing on disk")
    return FileResponse(
        path=resume.file_path,
        media_type=resume.content_type or "application/pdf",
        filename=resume.filename,
    )


@router.delete("/{resume_id}", status_code=204)
def delete_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    resume = (
        db.query(Resume)
        .filter(Resume.id == resume_id, Resume.user_id == user.id)
        .first()
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    try:
        if resume.file_path and os.path.exists(resume.file_path):
            os.remove(resume.file_path)
    except OSError:
        # File missing or unwritable — proceed with DB delete anyway
        pass

    db.delete(resume)
    db.commit()
    return None


# ----- Phase 3: parsing -----

@router.post("/{resume_id}/parse", response_model=ResumeParseOut)
def parse_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    resume = (
        db.query(Resume)
        .filter(Resume.id == resume_id, Resume.user_id == user.id)
        .first()
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    try:
        parsed, raw_text = parse_pdf(resume.file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parsing failed: {e}")

    # Upsert: replace existing parse if there is one
    existing = (
        db.query(ResumeParse).filter(ResumeParse.resume_id == resume_id).first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    parse_row = ResumeParse(
        resume_id=resume_id,
        full_name=parsed.get("full_name"),
        email=parsed.get("email"),
        phone=parsed.get("phone"),
        location=parsed.get("location"),
        linkedin_url=parsed.get("linkedin_url"),
        github_url=parsed.get("github_url"),
        summary=parsed.get("summary"),
        skills=parsed.get("skills") or [],
        work_experience=parsed.get("work_experience") or [],
        education=parsed.get("education") or [],
        raw_text=raw_text,
    )
    db.add(parse_row)
    db.commit()
    db.refresh(parse_row)
    return parse_row


@router.get("/{resume_id}/parse", response_model=ResumeParseOut)
def get_resume_parse(
    resume_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    resume = (
        db.query(Resume)
        .filter(Resume.id == resume_id, Resume.user_id == user.id)
        .first()
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    parse_row = (
        db.query(ResumeParse).filter(ResumeParse.resume_id == resume_id).first()
    )
    if not parse_row:
        raise HTTPException(status_code=404, detail="Resume not parsed yet")
    return parse_row