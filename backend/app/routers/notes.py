# backend/app/routers/notes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application, Note
from app.schemas import NoteCreate, NoteUpdate, NoteOut

router = APIRouter(prefix="/api/v1/applications/{application_id}/notes", tags=["notes"])


def _get_app_or_404(db: Session, app_id: int, user_id: str) -> Application:
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_obj


@router.get("", response_model=List[NoteOut])
def list_notes(application_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    return db.query(Note).filter(Note.application_id == application_id).order_by(Note.created_at.desc()).all()


@router.post("", response_model=NoteOut, status_code=201)
def create_note(application_id: int, payload: NoteCreate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = Note(**payload.model_dump(), application_id=application_id)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(application_id: int, note_id: int, payload: NoteUpdate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = db.query(Note).filter(Note.id == note_id, Note.application_id == application_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Note not found")
    for f, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, f, v)
    db.commit(); db.refresh(obj)
    return obj


@router.delete("/{note_id}", status_code=204)
def delete_note(application_id: int, note_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = db.query(Note).filter(Note.id == note_id, Note.application_id == application_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(obj); db.commit()