# backend/app/routers/contacts.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application, Contact
from app.schemas import ContactCreate, ContactUpdate, ContactOut

router = APIRouter(prefix="/api/v1/applications/{application_id}/contacts", tags=["contacts"])


def _get_app_or_404(db: Session, app_id: int, user_id: str) -> Application:
    app_obj = (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )
    if not app_obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_obj


@router.get("", response_model=List[ContactOut])
def list_contacts(application_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    return db.query(Contact).filter(Contact.application_id == application_id).all()


@router.post("", response_model=ContactOut, status_code=201)
def create_contact(application_id: int, payload: ContactCreate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = Contact(**payload.model_dump(), application_id=application_id)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(application_id: int, contact_id: int, payload: ContactUpdate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = db.query(Contact).filter(Contact.id == contact_id, Contact.application_id == application_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Contact not found")
    for f, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, f, v)
    db.commit(); db.refresh(obj)
    return obj


@router.delete("/{contact_id}", status_code=204)
def delete_contact(application_id: int, contact_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _get_app_or_404(db, application_id, user.id)
    obj = db.query(Contact).filter(Contact.id == contact_id, Contact.application_id == application_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(obj); db.commit()