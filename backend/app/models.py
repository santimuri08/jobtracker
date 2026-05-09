# backend/app/models.py
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Enum, JSON,
    Numeric, Date, Boolean, func
)
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
import enum

from app.database import Base


# --- Enums ---

class ApplicationStatus(str, enum.Enum):
    saved = "saved"
    applied = "applied"
    interviewing = "interviewing"
    offer = "offer"
    rejected = "rejected"
    withdrawn = "withdrawn"


class InterviewType(str, enum.Enum):
    phone_screen = "phone_screen"
    technical = "technical"
    behavioral = "behavioral"
    onsite = "onsite"
    final = "final"
    other = "other"


class InterviewOutcome(str, enum.Enum):
    pending = "pending"
    passed = "passed"
    failed = "failed"
    cancelled = "cancelled"


# --- User (read-only mirror of Prisma's table) ---

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=True)
    password_hash = Column("passwordHash", String, nullable=True)
    image = Column(String, nullable=True)
    email_verified = Column("emailVerified", DateTime(timezone=True), nullable=True)
    created_at = Column("createdAt", DateTime(timezone=True), server_default=func.now())
    updated_at = Column("updatedAt", DateTime(timezone=True), server_default=func.now())

    applications = relationship("Application", back_populates="user", cascade="all, delete-orphan")
    resumes = relationship("Resume", back_populates="user", cascade="all, delete-orphan")
    email_preference = relationship("EmailPreference", back_populates="user", uselist=False, cascade="all, delete-orphan")


# --- Application ---

class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    company = Column(String, nullable=False)
    role = Column(String, nullable=False)
    location = Column(String, nullable=True)
    job_url = Column(String, nullable=True)
    job_description = Column(Text, nullable=True)
    salary_min = Column(Numeric, nullable=True)
    salary_max = Column(Numeric, nullable=True)
    status = Column(Enum(ApplicationStatus, name="application_status"), nullable=False, default=ApplicationStatus.saved)
    applied_date = Column(Date, nullable=True)
    source = Column(String, nullable=True)

    resume_id = Column(Integer, ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    embedding = Column(Vector(1024), nullable=True)

    user = relationship("User", back_populates="applications")
    resume = relationship("Resume", back_populates="applications")
    interview_rounds = relationship("InterviewRound", back_populates="application", cascade="all, delete-orphan", order_by="InterviewRound.round_number")
    contacts = relationship("Contact", back_populates="application", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="application", cascade="all, delete-orphan", order_by="Note.created_at.desc()")
    gap_analysis = relationship(
        "GapAnalysis",
        back_populates="application",
        uselist=False,
        cascade="all, delete-orphan",
    )
    cover_letters = relationship(
        "CoverLetter",
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="CoverLetter.created_at.desc()",
    )


# --- InterviewRound ---

class InterviewRound(Base):
    __tablename__ = "interview_rounds"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)

    round_number = Column(Integer, nullable=False)
    type = Column(Enum(InterviewType, name="interview_type"), nullable=False, default=InterviewType.other)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    interviewer = Column(String, nullable=True)
    outcome = Column(Enum(InterviewOutcome, name="interview_outcome"), nullable=False, default=InterviewOutcome.pending)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    application = relationship("Application", back_populates="interview_rounds")


# --- Contact ---

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String, nullable=False)
    role = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("Application", back_populates="contacts")


# --- Note ---

class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)

    content = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("Application", back_populates="notes")


# --- Resume ---

class Resume(Base):
    __tablename__ = "resumes"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    label = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="application/pdf")
    size_bytes = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="resumes")
    applications = relationship("Application", back_populates="resume")
    parse = relationship("ResumeParse", back_populates="resume", uselist=False, cascade="all, delete-orphan")


# --- ResumeParse (Phase 3) ---

class ResumeParse(Base):
    __tablename__ = "resume_parses"

    id = Column(Integer, primary_key=True)
    resume_id = Column(Integer, ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Top-level extracted fields
    full_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    location = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    summary = Column(Text, nullable=True)

    # Structured arrays stored as JSON
    skills = Column(JSON, nullable=True)            # ["Python", "React", ...]
    work_experience = Column(JSON, nullable=True)   # [{company, title, start, end, bullets[]}]
    education = Column(JSON, nullable=True)         # [{school, degree, start, end}]

    # Raw text fallback
    raw_text = Column(Text, nullable=True)

    # Metadata
    parser_version = Column(String, nullable=False, default="claude-v1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    resume = relationship("Resume", back_populates="parse")


# --- GapAnalysis (Phase 4) ---

class GapAnalysis(Base):
    __tablename__ = "gap_analyses"

    id = Column(Integer, primary_key=True)
    application_id = Column(
        Integer,
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Top-level scalar
    fit_score = Column(Integer, nullable=True)  # 0-100

    # Structured arrays as JSON
    matched_skills = Column(JSON, nullable=True)
    missing_skills = Column(JSON, nullable=True)
    experience_gaps = Column(JSON, nullable=True)
    recommendations = Column(JSON, nullable=True)

    summary = Column(Text, nullable=True)

    # Metadata
    analyzer_version = Column(String, nullable=False, default="claude-v1")
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    application = relationship("Application", back_populates="gap_analysis")


# --- CoverLetter (Phase 5) ---

class CoverLetter(Base):
    __tablename__ = "cover_letters"

    id = Column(Integer, primary_key=True)
    application_id = Column(
        Integer,
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    content = Column(Text, nullable=False)
    version_label = Column(String, nullable=True)  # e.g. "Draft 1", "Final"
    is_active = Column(Boolean, nullable=False, default=False)

    generator_version = Column(String, nullable=False, default="claude-v1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    application = relationship("Application", back_populates="cover_letters")


# --- EmailPreference (Phase 7) ---

class EmailPreference(Base):
    __tablename__ = "email_preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # "weekly" or "off"
    frequency = Column(String, nullable=False, default="weekly")
    # When the last email was successfully sent
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    # Random opaque token for one-click unsubscribe links
    unsubscribe_token = Column(String, nullable=False, unique=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="email_preference")


# --- ScheduledJobRun (Phase 7) ---

class ScheduledJobRun(Base):
    __tablename__ = "scheduled_job_runs"

    id = Column(Integer, primary_key=True)
    job_name = Column(String, nullable=False, index=True)   # e.g. "weekly_summary"
    status = Column(String, nullable=False)                 # "success" | "error"
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    users_processed = Column(Integer, nullable=True)
    emails_sent = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)