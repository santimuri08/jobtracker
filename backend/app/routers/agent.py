# backend/app/routers/agent.py
"""
The chat agent.

POST /api/v1/agent/chat
Body: { "messages": [...full conversation history with the standard
                     Anthropic content-block shape...] }
Returns: { "messages": [...updated history with assistant turns appended...] }

The agent runs a tool-use loop:
  1. Send conversation + tool definitions to Claude.
  2. If Claude emits a tool_use block, execute the tool against the
     existing routers' logic (using the authenticated user's id), send
     the tool_result back, loop.
  3. When Claude returns a plain text block (no tool_use), we stop and
     return the full messages array.

Every tool maps to one of the routers built in earlier phases. Scope
is enforced by the user id from `get_current_user`, same isolation
guarantee every other endpoint has.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, date, timedelta, timezone
from typing import Any, Tuple

from anthropic import Anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models import (
    Application,
    ApplicationStatus,
    CoverLetter,
    Contact,
    GapAnalysis,
    InterviewOutcome,
    InterviewRound,
    InterviewType,
    Note,
    Reminder,
    Resume,
    ResumeParse,
)
from app.services.gap_analysis import run_gap_analysis
from app.services.cover_letter import run_cover_letter
from app.services.bullet_rewriter import run_bullet_rewrite

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


# ---------- request / response shape ----------

class ChatIn(BaseModel):
    messages: list[dict[str, Any]]   # Anthropic-shaped messages


class ChatOut(BaseModel):
    messages: list[dict[str, Any]]   # full updated history


# ---------- system prompt ----------

SYSTEM_PROMPT = """You are JobAgent, an AI assistant that helps users manage their entire job search through chat.

You have tools for almost every action a user could want. Be proactive: when a request is doable with your tools, just do it. Do not refuse a task that your tools cover.

## Your capabilities (every one of these has a tool)

Applications:
- Add, update, list, delete applications.
- Show a pipeline summary by status.
- Check whether an application is ready for AI features (has JD + parsed resume).

AI features per application:
- Run a gap analysis (resume vs. job description).
- Generate a tailored cover letter.
- Rewrite a single resume bullet into 3 styles.
- Find semantically similar applications the user has saved.

Interview tracking per application:
- Add interview rounds with type / interviewer / scheduled date.
- Delete interview rounds.

Contacts and notes per application:
- Add a contact (recruiter, hiring manager, referral).
- Add a free-text note.

Reminders:
- Create a reminder ("remind me to follow up on Stripe Friday").
- List upcoming, overdue, or pending reminders.
- Mark reminders complete when done.

Resumes:
- List the user's uploaded resumes.
- Link a resume to an application.

## How to behave

- Be concise and friendly. Use plain text, not markdown lists unless you have 3+ items.
- When the user describes a job they applied to, extract every field you can (company, role, location, status, salary range, source, job URL, JD).
- Default to status "applied" if they applied, "saved" if they just bookmarked it, "interviewing" if they have an interview lined up.
- If a required field is missing (e.g. company but no role), ASK before adding. Don't invent fields.
- After calling a tool, briefly confirm what happened in plain language. Don't dump JSON.
- If a tool returns "missing_requirements", read its `missing` and `actions` arrays and tell the user the specific next step ("Want me to use your latest resume? It's not linked to this app yet."). Then call the appropriate follow-up tool if the user agrees.
- Before running gap analysis or generating a cover letter, you can call `check_application_readiness` if you're unsure whether the app has everything needed. If it doesn't, proactively offer to fix the gap (e.g. "Your resume isn't linked yet — want me to link your most recent one?").
- When the user asks to schedule an interview or add a round, accept loose date phrases ("next Tuesday at 2pm", "Friday", "tomorrow") and convert them to ISO date strings yourself before calling the tool.
- For reminders, ALWAYS convert the user's natural date/time phrase to ISO 8601 (YYYY-MM-DDTHH:MM:SSZ) yourself before calling create_reminder. The tool will reject anything else. If the user is vague about the time (just "Friday"), default to 9am their local time and confirm.

## What you CANNOT do (be honest about these)

- Send emails on the user's behalf.
- Scrape live job postings from job sites.
- Make phone calls or send SMS.
- Modify the user's calendar (you can suggest interview times but not add to Google Calendar).
- Export data as a downloadable file (the dashboard has CSV export instead).

For anything else within your tool list — just do it. Don't say "I can't" if you actually can.
"""


# ---------- tool definitions for Claude ----------

TOOLS: list[dict[str, Any]] = [
    # ---- Existing application CRUD tools ----
    {
        "name": "add_application",
        "description": "Add a new job application to the user's tracker. Use when the user says they applied to or saved a job.",
        "input_schema": {
            "type": "object",
            "properties": {
                "company": {"type": "string", "description": "Company name."},
                "role": {"type": "string", "description": "Job title."},
                "location": {"type": "string", "description": "Location (city, remote, hybrid, etc.)."},
                "job_url": {"type": "string", "description": "Posting URL if mentioned."},
                "job_description": {"type": "string", "description": "Full job description text if the user pasted it."},
                "salary_min": {"type": "number"},
                "salary_max": {"type": "number"},
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"],
                    "description": "Default to 'applied' if the user says they applied."
                },
                "applied_date": {"type": "string", "description": "ISO date (YYYY-MM-DD) if mentioned."},
                "source": {"type": "string", "description": "Where they found the job (LinkedIn, referral, etc.)."},
                "resume_id": {"type": "integer", "description": "ID of a resume to link to this application."},
            },
            "required": ["company", "role"],
        },
    },
    {
        "name": "list_applications",
        "description": "List the user's applications. Use when they ask 'what apps do I have' or 'show me my pipeline'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"],
                    "description": "Filter by status (optional)."
                },
                "company": {"type": "string", "description": "Filter by company name (substring match)."},
            },
        },
    },
    {
        "name": "pipeline_summary",
        "description": "Get a count of applications grouped by status. Use when the user asks 'what's my pipeline' or 'how many apps do I have'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "update_application",
        "description": "Update fields on an existing application. Use when the user says 'change Figma to interviewing' or similar. Look up the id from list_applications first if needed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer", "description": "The numeric id of the application."},
                "company": {"type": "string"},
                "role": {"type": "string"},
                "location": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]
                },
                "applied_date": {"type": "string", "description": "ISO date."},
                "salary_min": {"type": "number"},
                "salary_max": {"type": "number"},
                "job_description": {"type": "string"},
                "job_url": {"type": "string"},
                "source": {"type": "string"},
                "resume_id": {"type": "integer", "description": "Link a resume to this application by id."},
            },
            "required": ["application_id"],
        },
    },
    {
        "name": "delete_application",
        "description": "Permanently delete an application. Only do this when the user explicitly asks to delete or remove one.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
            },
            "required": ["application_id"],
        },
    },

    # ---- Resume management ----
    {
        "name": "list_resumes",
        "description": "List the user's uploaded resumes (with id, label, and whether they've been parsed). Use when the user asks about their resumes or before linking one to an application.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "link_resume_to_application",
        "description": "Link an existing resume to an application by setting application.resume_id. Use this when the user wants to attach a resume so they can run gap analysis or generate cover letters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "resume_id": {"type": "integer"},
            },
            "required": ["application_id", "resume_id"],
        },
    },

    # ---- Readiness ----
    {
        "name": "check_application_readiness",
        "description": "Check whether an application has everything needed for gap analysis or cover letter generation (job_description + linked_resume + parsed_resume). Returns either {ready: true} or {ready: false, missing: [...], actions: [...]}.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
            },
            "required": ["application_id"],
        },
    },

    # ---- AI features ----
    {
        "name": "run_gap_analysis",
        "description": "Compare the user's linked resume against the application's job description and return a fit score plus matched/missing skills. Requires the application to have a job description and a linked, parsed resume. Takes ~10 seconds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
            },
            "required": ["application_id"],
        },
    },
    {
        "name": "generate_cover_letter",
        "description": "Generate a tailored cover letter for an application using the linked, parsed resume. Requires job description + linked parsed resume. Saves it as a new draft. Takes ~10 seconds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "tone": {
                    "type": "string",
                    "description": "Optional tone keyword (e.g. 'enthusiastic', 'professional', 'concise')."
                },
                "extra_instructions": {
                    "type": "string",
                    "description": "Optional extra instructions from the user."
                },
            },
            "required": ["application_id"],
        },
    },
    {
        "name": "rewrite_bullet",
        "description": "Rewrite a single resume bullet into three styles: impact, concise, and ATS-keyword-friendly. The user pastes a bullet. Optionally provide an application_id for ATS keyword context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bullet": {"type": "string", "description": "The original resume bullet to rewrite."},
                "application_id": {
                    "type": "integer",
                    "description": "Optional. If given, the application's job description provides ATS keywords."
                },
            },
            "required": ["bullet"],
        },
    },
    {
        "name": "find_similar_applications",
        "description": "Find the most semantically similar applications the user has saved, based on job description embeddings. Returns up to N matches with similarity scores. Requires the source app to have an embedding (i.e. a job description was set when created or updated).",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "limit": {"type": "integer", "description": "Max results (1-20, default 5)."},
            },
            "required": ["application_id"],
        },
    },

    # ---- Interview rounds ----
    {
        "name": "add_interview_round",
        "description": "Add an interview round to an application. Use when the user says they have an interview scheduled or completed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "type": {
                    "type": "string",
                    "enum": ["phone_screen", "technical", "behavioral", "onsite", "final", "other"],
                    "description": "Type of interview round."
                },
                "scheduled_at": {
                    "type": "string",
                    "description": "ISO 8601 datetime (YYYY-MM-DDTHH:MM:SS) if known."
                },
                "interviewer": {"type": "string", "description": "Name of the interviewer if known."},
                "outcome": {
                    "type": "string",
                    "enum": ["pending", "passed", "failed", "cancelled"],
                    "description": "Defaults to 'pending'."
                },
                "notes": {"type": "string", "description": "Optional notes from or about the round."},
            },
            "required": ["application_id", "type"],
        },
    },
    {
        "name": "delete_interview_round",
        "description": "Delete a specific interview round from an application.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "round_id": {"type": "integer"},
            },
            "required": ["application_id", "round_id"],
        },
    },

    # ---- Contacts and notes ----
    {
        "name": "add_contact",
        "description": "Add a contact (recruiter, hiring manager, referrer) to an application.",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "name": {"type": "string"},
                "role": {"type": "string", "description": "Their role (e.g. 'Recruiter', 'Hiring Manager')."},
                "email": {"type": "string"},
                "phone": {"type": "string"},
            },
            "required": ["application_id", "name"],
        },
    },
    {
        "name": "add_note",
        "description": "Add a free-text note to an application. Use this for any observation the user mentions (e.g. 'recruiter said 2 rounds', 'salary is negotiable').",
        "input_schema": {
            "type": "object",
            "properties": {
                "application_id": {"type": "integer"},
                "content": {"type": "string"},
            },
            "required": ["application_id", "content"],
        },
    },

    # ---- Reminders (Phase 2.2) ----
    {
        "name": "create_reminder",
        "description": "Create a reminder for the user. Use when they say 'remind me to X on Y' or 'follow up with Z in 3 days'. Convert any natural date/time phrase to ISO 8601 (YYYY-MM-DDTHH:MM:SSZ) before calling. If the reminder is about a specific application, pass application_id; otherwise leave it out.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "What to remind the user about (the action they need to take)."
                },
                "due_at": {
                    "type": "string",
                    "description": "ISO 8601 datetime (YYYY-MM-DDTHH:MM:SSZ). YOU must convert phrases like 'next Tuesday at 2pm' or 'in 5 days' into this format before calling."
                },
                "application_id": {
                    "type": "integer",
                    "description": "Optional. Attach the reminder to a specific application."
                },
            },
            "required": ["message", "due_at"],
        },
    },
    {
        "name": "list_reminders",
        "description": "List the user's reminders. Use when they ask 'what reminders do I have', 'show overdue reminders', etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["pending", "completed", "overdue", "due_soon"],
                    "description": "Filter: pending (not yet done), completed (done), overdue (past due and not done), due_soon (next 7 days). Default: all."
                },
                "application_id": {
                    "type": "integer",
                    "description": "Optional: only reminders for a specific application."
                },
            },
        },
    },
    {
        "name": "complete_reminder",
        "description": "Mark a reminder as done. Use when the user says 'I followed up' or 'mark X complete'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reminder_id": {"type": "integer"},
            },
            "required": ["reminder_id"],
        },
    },
]


# ---------- helpers ----------

def _serialize_app(a: Application) -> dict[str, Any]:
    """Lightweight serializer for tool_results going back to Claude."""
    return {
        "id": a.id,
        "company": a.company,
        "role": a.role,
        "location": a.location,
        "status": a.status.value if a.status else None,
        "applied_date": a.applied_date.isoformat() if a.applied_date else None,
        "salary_min": float(a.salary_min) if a.salary_min is not None else None,
        "salary_max": float(a.salary_max) if a.salary_max is not None else None,
        "source": a.source,
        "job_url": a.job_url,
        "resume_id": a.resume_id,
    }


def _get_user_app(db: Session, user_id: str, app_id: int) -> Application | None:
    return (
        db.query(Application)
        .filter(Application.id == app_id, Application.user_id == user_id)
        .first()
    )


def _readiness(db: Session, app_obj: Application) -> dict[str, Any]:
    """
    Same logic as the routers' _check_application_ready but returns a dict
    instead of raising. Lets the agent check before calling AI features.
    """
    missing: list[str] = []
    if not app_obj.job_description or not app_obj.job_description.strip():
        missing.append("job_description")

    parse: ResumeParse | None = None
    if not app_obj.resume_id:
        missing.extend(["linked_resume", "parsed_resume"])
    else:
        parse = (
            db.query(ResumeParse)
            .filter(ResumeParse.resume_id == app_obj.resume_id)
            .first()
        )
        if not parse:
            missing.append("parsed_resume")

    if not missing:
        return {"ready": True, "application_id": app_obj.id}

    return {
        "ready": False,
        "application_id": app_obj.id,
        "missing": missing,
    }


def _resume_parse_dict(parse: ResumeParse) -> dict:
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


# ---------- tool executors ----------

def _tool_add_application(db: Session, user_id: str, args: dict) -> dict:
    payload = {k: v for k, v in args.items() if v is not None}

    if "applied_date" in payload and isinstance(payload["applied_date"], str):
        try:
            payload["applied_date"] = date.fromisoformat(payload["applied_date"])
        except ValueError:
            del payload["applied_date"]

    if "status" in payload and isinstance(payload["status"], str):
        try:
            payload["status"] = ApplicationStatus(payload["status"])
        except ValueError:
            payload["status"] = ApplicationStatus.applied
    else:
        payload.setdefault("status", ApplicationStatus.applied)

    # Guard: if resume_id provided, make sure it belongs to this user
    if "resume_id" in payload:
        resume = (
            db.query(Resume)
            .filter(Resume.id == payload["resume_id"], Resume.user_id == user_id)
            .first()
        )
        if not resume:
            return {"ok": False, "error": f"Resume {payload['resume_id']} not found."}

    app_obj = Application(**payload, user_id=user_id)
    db.add(app_obj)
    db.commit()
    db.refresh(app_obj)
    return {"ok": True, "application": _serialize_app(app_obj)}


def _tool_list_applications(db: Session, user_id: str, args: dict) -> dict:
    q = db.query(Application).filter(Application.user_id == user_id)
    if args.get("status"):
        try:
            q = q.filter(Application.status == ApplicationStatus(args["status"]))
        except ValueError:
            pass
    if args.get("company"):
        q = q.filter(Application.company.ilike(f"%{args['company']}%"))
    rows = q.order_by(Application.created_at.desc()).limit(50).all()
    return {"count": len(rows), "applications": [_serialize_app(a) for a in rows]}


def _tool_pipeline_summary(db: Session, user_id: str, _args: dict) -> dict:
    from sqlalchemy import func
    rows = (
        db.query(Application.status, func.count(Application.id))
        .filter(Application.user_id == user_id)
        .group_by(Application.status)
        .all()
    )
    summary = {s.value: 0 for s in ApplicationStatus}
    for status, count in rows:
        summary[status.value] = count
    summary["total"] = sum(summary.values())
    return summary


def _tool_update_application(db: Session, user_id: str, args: dict) -> dict:
    app_id = args.pop("application_id")
    app_obj = _get_user_app(db, user_id, app_id)
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    if "applied_date" in args and isinstance(args["applied_date"], str):
        try:
            args["applied_date"] = date.fromisoformat(args["applied_date"])
        except ValueError:
            del args["applied_date"]
    if "status" in args and isinstance(args["status"], str):
        try:
            args["status"] = ApplicationStatus(args["status"])
        except ValueError:
            del args["status"]

    if "resume_id" in args and args["resume_id"] is not None:
        resume = (
            db.query(Resume)
            .filter(Resume.id == args["resume_id"], Resume.user_id == user_id)
            .first()
        )
        if not resume:
            return {"ok": False, "error": f"Resume {args['resume_id']} not found."}

    for k, v in args.items():
        if v is not None:
            setattr(app_obj, k, v)
    db.commit()
    db.refresh(app_obj)
    return {"ok": True, "application": _serialize_app(app_obj)}


def _tool_delete_application(db: Session, user_id: str, args: dict) -> dict:
    app_id = args["application_id"]
    app_obj = _get_user_app(db, user_id, app_id)
    if not app_obj:
        return {"ok": False, "error": "Application not found."}
    company = app_obj.company
    db.delete(app_obj)
    db.commit()
    return {"ok": True, "deleted_company": company}


def _tool_list_resumes(db: Session, user_id: str, _args: dict) -> dict:
    rows = (
        db.query(Resume)
        .filter(Resume.user_id == user_id)
        .order_by(Resume.created_at.desc())
        .all()
    )
    out = []
    for r in rows:
        parse = (
            db.query(ResumeParse)
            .filter(ResumeParse.resume_id == r.id)
            .first()
        )
        out.append({
            "id": r.id,
            "label": r.label,
            "filename": r.filename,
            "is_parsed": parse is not None,
            "parsed_name": parse.full_name if parse else None,
        })
    return {"count": len(out), "resumes": out}


def _tool_link_resume_to_application(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    resume = (
        db.query(Resume)
        .filter(Resume.id == args["resume_id"], Resume.user_id == user_id)
        .first()
    )
    if not resume:
        return {"ok": False, "error": "Resume not found."}

    app_obj.resume_id = resume.id
    db.commit()
    db.refresh(app_obj)
    return {
        "ok": True,
        "application_id": app_obj.id,
        "resume_id": resume.id,
        "resume_label": resume.label,
    }


def _tool_check_application_readiness(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}
    return _readiness(db, app_obj)


def _tool_run_gap_analysis(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    readiness = _readiness(db, app_obj)
    if not readiness["ready"]:
        return {"ok": False, "error": "missing_requirements", **readiness}

    parse = (
        db.query(ResumeParse)
        .filter(ResumeParse.resume_id == app_obj.resume_id)
        .first()
    )
    resume_dict = _resume_parse_dict(parse)

    try:
        result = run_gap_analysis(resume_dict, app_obj.job_description)
    except Exception as e:
        logger.exception("agent: run_gap_analysis failed for app_id=%s", app_obj.id)
        return {"ok": False, "error": f"Gap analysis failed: {type(e).__name__}"}

    # Upsert (same pattern as the dashboard router)
    existing = (
        db.query(GapAnalysis)
        .filter(GapAnalysis.application_id == app_obj.id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    row = GapAnalysis(
        application_id=app_obj.id,
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

    return {
        "ok": True,
        "application_id": app_obj.id,
        "company": app_obj.company,
        "role": app_obj.role,
        "fit_score": row.fit_score,
        "matched_skills": row.matched_skills,
        "missing_skills": row.missing_skills,
        "experience_gaps": row.experience_gaps,
        "recommendations": row.recommendations,
        "summary": row.summary,
    }


def _tool_generate_cover_letter(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    readiness = _readiness(db, app_obj)
    if not readiness["ready"]:
        return {"ok": False, "error": "missing_requirements", **readiness}

    parse = (
        db.query(ResumeParse)
        .filter(ResumeParse.resume_id == app_obj.resume_id)
        .first()
    )

    try:
        result = run_cover_letter(
            resume_parse=_resume_parse_dict(parse),
            job_description=app_obj.job_description,
            company=app_obj.company,
            role=app_obj.role,
            tone=args.get("tone"),
            extra_instructions=args.get("extra_instructions"),
        )
    except Exception as e:
        logger.exception("agent: run_cover_letter failed for app_id=%s", app_obj.id)
        return {"ok": False, "error": f"Cover letter generation failed: {type(e).__name__}"}

    content = (result.get("content") or "").strip()
    if not content:
        return {"ok": False, "error": "AI returned empty cover letter"}

    existing_count = (
        db.query(CoverLetter)
        .filter(CoverLetter.application_id == app_obj.id)
        .count()
    )
    is_active = existing_count == 0
    label = f"Draft {existing_count + 1}"

    obj = CoverLetter(
        application_id=app_obj.id,
        content=content,
        version_label=label,
        is_active=is_active,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    return {
        "ok": True,
        "application_id": app_obj.id,
        "company": app_obj.company,
        "role": app_obj.role,
        "letter_id": obj.id,
        "version_label": obj.version_label,
        "is_active": obj.is_active,
        "content": obj.content,
    }


def _tool_rewrite_bullet(db: Session, user_id: str, args: dict) -> dict:
    bullet = (args.get("bullet") or "").strip()
    if not bullet:
        return {"ok": False, "error": "Bullet is empty."}

    job_description: str | None = None
    if args.get("application_id"):
        app_obj = _get_user_app(db, user_id, args["application_id"])
        if app_obj and app_obj.job_description:
            job_description = app_obj.job_description

    try:
        result = run_bullet_rewrite(bullet=bullet, job_description=job_description)
    except Exception as e:
        logger.exception("agent: run_bullet_rewrite failed")
        return {"ok": False, "error": f"Bullet rewrite failed: {type(e).__name__}"}

    variants = result.get("variants") or []
    return {"ok": True, "variants": variants}


def _tool_find_similar_applications(db: Session, user_id: str, args: dict) -> dict:
    source = _get_user_app(db, user_id, args["application_id"])
    if not source:
        return {"ok": False, "error": "Application not found."}
    if source.embedding is None:
        return {
            "ok": False,
            "error": "no_embedding",
            "message": "This application has no embedding. Add a job description first.",
        }

    limit = int(args.get("limit") or 5)
    if limit < 1:
        limit = 1
    if limit > 20:
        limit = 20

    distance = Application.embedding.cosine_distance(source.embedding).label("distance")
    rows = (
        db.query(Application, distance)
        .filter(Application.user_id == user_id)
        .filter(Application.id != source.id)
        .filter(Application.embedding.is_not(None))
        .order_by(distance.asc())
        .limit(limit)
        .all()
    )

    out = []
    for app_obj, dist in rows:
        sim = max(0.0, min(1.0, 1.0 - float(dist)))
        out.append({
            "id": app_obj.id,
            "company": app_obj.company,
            "role": app_obj.role,
            "status": app_obj.status.value,
            "similarity": round(sim, 3),
        })
    return {"ok": True, "count": len(out), "results": out}


def _tool_add_interview_round(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    # Type / outcome enums
    try:
        round_type = InterviewType(args["type"])
    except (ValueError, KeyError):
        round_type = InterviewType.other

    outcome = InterviewOutcome.pending
    if args.get("outcome"):
        try:
            outcome = InterviewOutcome(args["outcome"])
        except ValueError:
            pass

    # Date parsing
    scheduled_at = None
    if args.get("scheduled_at"):
        try:
            scheduled_at = datetime.fromisoformat(args["scheduled_at"].replace("Z", "+00:00"))
        except ValueError:
            scheduled_at = None

    # round_number = next available
    next_num = (
        db.query(InterviewRound)
        .filter(InterviewRound.application_id == app_obj.id)
        .count()
    ) + 1

    obj = InterviewRound(
        application_id=app_obj.id,
        round_number=next_num,
        type=round_type,
        scheduled_at=scheduled_at,
        interviewer=args.get("interviewer"),
        outcome=outcome,
        notes=args.get("notes"),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "ok": True,
        "application_id": app_obj.id,
        "company": app_obj.company,
        "round_id": obj.id,
        "round_number": obj.round_number,
        "type": obj.type.value,
        "scheduled_at": obj.scheduled_at.isoformat() if obj.scheduled_at else None,
        "interviewer": obj.interviewer,
        "outcome": obj.outcome.value,
    }


def _tool_delete_interview_round(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    obj = (
        db.query(InterviewRound)
        .filter(
            InterviewRound.id == args["round_id"],
            InterviewRound.application_id == app_obj.id,
        )
        .first()
    )
    if not obj:
        return {"ok": False, "error": "Interview round not found."}

    db.delete(obj)
    db.commit()
    return {"ok": True, "deleted_round_id": args["round_id"]}


def _tool_add_contact(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    obj = Contact(
        application_id=app_obj.id,
        name=args["name"],
        role=args.get("role"),
        email=args.get("email"),
        phone=args.get("phone"),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "ok": True,
        "application_id": app_obj.id,
        "contact_id": obj.id,
        "name": obj.name,
        "role": obj.role,
    }


def _tool_add_note(db: Session, user_id: str, args: dict) -> dict:
    app_obj = _get_user_app(db, user_id, args["application_id"])
    if not app_obj:
        return {"ok": False, "error": "Application not found."}

    content = (args.get("content") or "").strip()
    if not content:
        return {"ok": False, "error": "Note content is empty."}

    obj = Note(application_id=app_obj.id, content=content)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "ok": True,
        "application_id": app_obj.id,
        "note_id": obj.id,
        "preview": content[:80],
    }


def _tool_create_reminder(db: Session, user_id: str, args: dict) -> dict:
    message = (args.get("message") or "").strip()
    if not message:
        return {"ok": False, "error": "Message cannot be empty."}

    due_at_str = args.get("due_at")
    if not due_at_str:
        return {"ok": False, "error": "due_at is required."}

    try:
        due_at = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return {"ok": False, "error": "due_at must be ISO 8601 datetime (e.g. 2026-05-15T14:00:00Z)."}

    application_id = args.get("application_id")
    if application_id is not None:
        # Verify the app belongs to this user
        app_obj = _get_user_app(db, user_id, application_id)
        if not app_obj:
            return {"ok": False, "error": f"Application {application_id} not found."}

    obj = Reminder(
        user_id=user_id,
        application_id=application_id,
        message=message,
        due_at=due_at,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "ok": True,
        "reminder_id": obj.id,
        "message": obj.message,
        "due_at": obj.due_at.isoformat(),
        "application_id": obj.application_id,
    }


def _tool_list_reminders(db: Session, user_id: str, args: dict) -> dict:
    q = db.query(Reminder).filter(Reminder.user_id == user_id)

    if args.get("application_id") is not None:
        q = q.filter(Reminder.application_id == args["application_id"])

    status = args.get("status")
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

    rows = q.order_by(Reminder.due_at.asc()).limit(50).all()
    out = []
    for r in rows:
        out.append({
            "id": r.id,
            "message": r.message,
            "due_at": r.due_at.isoformat(),
            "completed": r.completed_at is not None,
            "application_id": r.application_id,
        })
    return {"count": len(out), "reminders": out}


def _tool_complete_reminder(db: Session, user_id: str, args: dict) -> dict:
    obj = (
        db.query(Reminder)
        .filter(Reminder.id == args["reminder_id"], Reminder.user_id == user_id)
        .first()
    )
    if not obj:
        return {"ok": False, "error": "Reminder not found."}

    if obj.completed_at is not None:
        return {
            "ok": True,
            "already_complete": True,
            "reminder_id": obj.id,
            "message": obj.message,
        }

    obj.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(obj)
    return {
        "ok": True,
        "reminder_id": obj.id,
        "message": obj.message,
        "completed_at": obj.completed_at.isoformat(),
    }


TOOL_EXECUTORS = {
    # Existing application CRUD
    "add_application": _tool_add_application,
    "list_applications": _tool_list_applications,
    "pipeline_summary": _tool_pipeline_summary,
    "update_application": _tool_update_application,
    "delete_application": _tool_delete_application,
    # Resumes
    "list_resumes": _tool_list_resumes,
    "link_resume_to_application": _tool_link_resume_to_application,
    # Readiness
    "check_application_readiness": _tool_check_application_readiness,
    # AI features
    "run_gap_analysis": _tool_run_gap_analysis,
    "generate_cover_letter": _tool_generate_cover_letter,
    "rewrite_bullet": _tool_rewrite_bullet,
    "find_similar_applications": _tool_find_similar_applications,
    # Interview rounds
    "add_interview_round": _tool_add_interview_round,
    "delete_interview_round": _tool_delete_interview_round,
    # Contacts and notes
    "add_contact": _tool_add_contact,
    "add_note": _tool_add_note,
    # Reminders (Phase 2.2)
    "create_reminder": _tool_create_reminder,
    "list_reminders": _tool_list_reminders,
    "complete_reminder": _tool_complete_reminder,
}


# ---------- the loop ----------

def _run_agent_loop(
    db: Session,
    user_id: str,
    messages: list[dict[str, Any]],
    max_iterations: int = 10,
) -> list[dict[str, Any]]:
    """
    Run Claude with tool-use until it returns a final text response.
    Mutates and returns `messages`.
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=settings.anthropic_api_key)

    for _ in range(max_iterations):
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        logger.info(
            "agent turn stop_reason=%s in_tok=%s out_tok=%s",
            response.stop_reason,
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        assistant_blocks = [block.model_dump() for block in response.content]
        messages.append({"role": "assistant", "content": assistant_blocks})

        if response.stop_reason != "tool_use":
            return messages

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            tool_name = block.name
            tool_input = block.input or {}
            executor = TOOL_EXECUTORS.get(tool_name)
            try:
                if executor is None:
                    result = {"error": f"Unknown tool: {tool_name}"}
                else:
                    result = executor(db, user_id, dict(tool_input))
            except Exception as e:
                logger.exception("tool %s failed", tool_name)
                result = {"error": f"Tool raised: {type(e).__name__}: {e}"}

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str),
            })

        messages.append({"role": "user", "content": tool_results})

    messages.append({
        "role": "assistant",
        "content": [{"type": "text", "text": "I'm having trouble completing that — could you rephrase?"}]
    })
    return messages


# ---------- endpoint ----------

@router.post("/chat", response_model=ChatOut)
def chat(
    payload: ChatIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    try:
        updated = _run_agent_loop(db, user.id, list(payload.messages))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except Exception as e:
        logger.exception("agent loop failed")
        raise HTTPException(status_code=502, detail=f"Agent failed: {e}")

    return {"messages": updated}