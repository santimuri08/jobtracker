# backend/app/schemas.py
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Union, Any
from app.models import ApplicationStatus, InterviewType, InterviewOutcome


# ---------- shared base config ----------
class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- INTERVIEW ROUNDS ----------
class InterviewRoundBase(BaseModel):
    round_number: int = 1
    type: InterviewType = InterviewType.other
    scheduled_at: Optional[datetime] = None
    interviewer: Optional[str] = None
    outcome: InterviewOutcome = InterviewOutcome.pending
    notes: Optional[str] = None


class InterviewRoundCreate(InterviewRoundBase):
    pass


class InterviewRoundUpdate(BaseModel):
    round_number: Optional[int] = None
    type: Optional[InterviewType] = None
    scheduled_at: Optional[datetime] = None
    interviewer: Optional[str] = None
    outcome: Optional[InterviewOutcome] = None
    notes: Optional[str] = None


class InterviewRoundOut(ORMModel, InterviewRoundBase):
    id: int
    application_id: int
    created_at: datetime
    updated_at: datetime


# ---------- CONTACTS ----------
class ContactBase(BaseModel):
    name: str
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


class ContactOut(ORMModel, ContactBase):
    id: int
    application_id: int
    created_at: datetime


# ---------- NOTES ----------
class NoteBase(BaseModel):
    content: str


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    content: Optional[str] = None


class NoteOut(ORMModel, NoteBase):
    id: int
    application_id: int
    created_at: datetime
    updated_at: datetime


# ---------- RESUMES ----------
class ResumeOut(ORMModel):
    id: int
    label: str
    filename: str
    content_type: Optional[str]
    size_bytes: Optional[int]
    created_at: datetime


# ---------- APPLICATIONS ----------
class ApplicationBase(BaseModel):
    company: str
    role: str
    location: Optional[str] = None
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    status: ApplicationStatus = ApplicationStatus.saved
    applied_date: Optional[date] = None
    source: Optional[str] = None
    resume_id: Optional[int] = None


class ApplicationCreate(ApplicationBase):
    pass


class ApplicationUpdate(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    status: Optional[ApplicationStatus] = None
    applied_date: Optional[date] = None
    source: Optional[str] = None
    resume_id: Optional[int] = None


class ApplicationOut(ORMModel, ApplicationBase):
    id: int
    user_id: str
    created_at: datetime
    updated_at: datetime


class ApplicationDetailOut(ApplicationOut):
    interview_rounds: List[InterviewRoundOut] = []
    contacts: List[ContactOut] = []
    notes: List[NoteOut] = []
    resume: Optional[ResumeOut] = None


# ---------- PIPELINE SUMMARY ----------
class PipelineSummary(BaseModel):
    saved: int = 0
    applied: int = 0
    interviewing: int = 0
    offer: int = 0
    rejected: int = 0
    withdrawn: int = 0
    total: int = 0


# --- Resume parsing ---

class WorkExperience(BaseModel):
    company: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    bullets: list[str] = []


class Education(BaseModel):
    school: str | None = None
    degree: str | None = None
    field: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class ResumeParseOut(ORMModel):
    id: int
    resume_id: int
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    summary: str | None = None
    skills: list[str] | None = None
    work_experience: list[WorkExperience] | None = None
    education: list[Education] | None = None
    parser_version: str
    created_at: datetime
    updated_at: datetime


# --- GapAnalysis (Phase 4) ---

class ExperienceGap(BaseModel):
    requirement: str
    your_experience: str | None = None
    gap: str


class GapAnalysisOut(ORMModel):
    id: int
    application_id: int
    fit_score: int | None = None
    matched_skills: list[str] | None = None
    missing_skills: list[str] | None = None
    experience_gaps: list[ExperienceGap] | None = None
    recommendations: list[str] | None = None
    summary: str | None = None
    analyzer_version: str
    created_at: datetime
    updated_at: datetime


# --- Cover letter (Phase 5) ---

class CoverLetterGenerateIn(BaseModel):
    """Optional fields the user can pass when generating."""
    tone: str | None = None              # e.g. "friendly", "formal", "enthusiastic"
    extra_instructions: str | None = None  # free-text guidance to Claude


class CoverLetterUpdate(BaseModel):
    content: str | None = None
    version_label: str | None = None
    is_active: bool | None = None


class CoverLetterOut(ORMModel):
    id: int
    application_id: int
    content: str
    version_label: str | None = None
    is_active: bool
    generator_version: str
    created_at: datetime
    updated_at: datetime


# --- Bullet rewrite (Phase 5) ---

class BulletRewriteIn(BaseModel):
    bullet: str
    job_description: str | None = None  # optional; if None we still rewrite generically


class BulletVariant(BaseModel):
    style: str        # "impact" | "concise" | "ats"
    text: str
    rationale: str | None = None


class BulletRewriteOut(BaseModel):
    original: str
    variants: list[BulletVariant]

# ---------- EMAIL PREFERENCES (Phase 7) ----------
class EmailPreferenceOut(ORMModel):
    frequency: str               # "weekly" | "off"
    last_sent_at: Optional[datetime] = None


class EmailPreferenceUpdate(BaseModel):
    frequency: str               # "weekly" | "off"


# ---------- WEEKLY SUMMARY TRIGGER (Phase 7) ----------
class TriggerWeeklySummaryOut(BaseModel):
    sent: bool
    skipped_reason: Optional[str] = None
    email_to: Optional[str] = None
    summary_preview: Optional[str] = None    # first 200 chars, for sanity-check


# ---------- REMINDERS (Phase 2.2) ----------
class ReminderBase(BaseModel):
    message: str
    due_at: datetime
    application_id: Optional[int] = None


class ReminderCreate(ReminderBase):
    pass


class ReminderUpdate(BaseModel):
    message: Optional[str] = None
    due_at: Optional[datetime] = None
    application_id: Optional[int] = None
    completed: Optional[bool] = None  # set true to mark done, false to un-complete


class ReminderOut(ORMModel):
    id: int
    user_id: str
    application_id: Optional[int] = None
    message: str
    due_at: datetime
    completed_at: Optional[datetime] = None
    created_at: datetime

# ============================================================
# Phase 4: Chat persistence
# ============================================================

# Anthropic-shaped content blocks. A message's `content` is either a
# plain string (simple user message) OR a list of typed blocks
# (assistant turns with tool_use, user turns with tool_result, etc.).
# We don't validate block shapes server-side — that's the agent's job;
# we just pass them through as JSONB.

class ChatMessageIn(BaseModel):
    """A single message sent up in a PUT /messages body."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: Union[str, list[dict[str, Any]]]


class ChatMessageOut(BaseModel):
    """A single message coming back from GET /chats/{id}."""
    role: str
    content: Union[str, list[dict[str, Any]]]
    position: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatListItem(BaseModel):
    """Compact shape for GET /chats (the sidebar list)."""
    id: str
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    message_count: int

    model_config = ConfigDict(from_attributes=True)


class ChatListOut(BaseModel):
    chats: list[ChatListItem]


class ChatDetail(BaseModel):
    """Full chat with messages for GET /chats/{id}."""
    id: str
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageOut]

    model_config = ConfigDict(from_attributes=True)


class ChatCreateIn(BaseModel):
    """POST /chats — id is optional (server generates if absent)."""
    id: Optional[str] = Field(default=None, max_length=80)
    title: Optional[str] = Field(default=None, max_length=200)


class ChatUpdateIn(BaseModel):
    """PATCH /chats/{id} — title only for now."""
    title: Optional[str] = Field(default=None, max_length=200)


class MessagesReplaceIn(BaseModel):
    """PUT /chats/{id}/messages — replaces entire message list."""
    messages: list[ChatMessageIn]


class MessagesReplaceOut(BaseModel):
    message_count: int
    updated_at: datetime
    title: Optional[str] = None