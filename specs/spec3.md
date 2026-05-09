# Phase 3 — Resume Upload & Parsing (In Progress)

## Status

**Not complete.** Code is written and committed locally, but the database is in a broken state and the backend can't serve requests against the new schema. The remaining blocker is that Alembic refuses to run because the `users` table (owned by Prisma) doesn't exist, and Prisma's `migrate deploy` keeps reporting "no pending migrations" — meaning Prisma is somehow connecting to a database that's not the empty one our backend uses, or its migration state is stuck.

Resume this phase by fixing the migration ordering before doing anything else. Details at the bottom.

---

## What Phase 3 set out to do

Resume parsing was carved out as its own phase because every future AI feature (job description analysis, interview prep, resume tailoring) reads from a structured resume. The job was: PDF upload from the frontend, storage on disk (filesystem, same volume Phase 2 set up), text extraction with pdfplumber on the backend, structured extraction via Claude into a new `resume_parses` table, a UI page to view the parse output, and a re-parse button.

The "done when" criteria are: a logged-in user uploads a PDF, clicks "Parse this resume," waits ~10 seconds, and sees structured fields (name, email, work experience bullets, skills, education) rendered on the page. None of that has been verified end-to-end yet because we got stuck on the migration step before we could test.

---

## The mental model

Phase 3 introduces a single new concept on top of Phase 2: a **services layer**. Until now the backend was just routers and models. The parsing logic doesn't belong in a router (too heavy, too reusable) and doesn't belong in a model (it's not data, it's behavior). So `backend/app/services/` is now where business logic lives — calls to external APIs, complex multi-step pipelines, anything that's not pure CRUD.

The pipeline itself is straightforward: `Resume.file_path` → pdfplumber reads the PDF and concatenates page text → that text gets shoved into a Claude prompt with a strict JSON schema → Claude returns JSON → we parse it and upsert a `ResumeParse` row keyed by `resume_id`. The relationship is one-to-one — a resume has at most one parse, and re-parsing replaces the old row instead of appending.

The new `ResumeParse` table is **wide and JSON-heavy on purpose**. Top-level scalar fields (`full_name`, `email`, `phone`) are real columns because we'll likely query them later. The structured arrays (`skills`, `work_experience`, `education`) live in `JSON` columns because their shape is fluid — Claude might give us 2 bullets per job today and 5 tomorrow, and we don't want a schema migration every time we tweak the prompt. If a future feature needs to query inside these (e.g., "find resumes mentioning React"), we can promote those fields out of JSON later or add a separate searchable mirror.

---

## What got built

### Backend

**`backend/requirements.txt`** — added two lines:
- `anthropic==0.39.0` — the official Anthropic Python SDK
- `pdfplumber==0.11.4` — pulls text out of PDFs without needing OCR

After editing, ran `docker compose build backend` to rebuild the image.

**`backend/app/config.py`** — added one optional setting:
```python
anthropic_api_key: str = ""
```
Empty default so the backend starts even if the key isn't set; only the parse endpoint will fail with a clear error.

**`backend/app/models.py`** — added a new model class:
```python
class ResumeParse(Base):
    __tablename__ = "resume_parses"

    id = Column(Integer, primary_key=True)
    resume_id = Column(Integer, ForeignKey("resumes.id", ondelete="CASCADE"),
                       nullable=False, unique=True)

    full_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    location = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    summary = Column(Text, nullable=True)

    skills = Column(JSON, nullable=True)
    work_experience = Column(JSON, nullable=True)
    education = Column(JSON, nullable=True)

    raw_text = Column(Text, nullable=True)

    parser_version = Column(String, nullable=False, default="claude-v1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    resume = relationship("Resume", back_populates="parse")
```

The `unique=True` on `resume_id` enforces the one-to-one rule at the DB level. Cascade delete means deleting a resume drops its parse automatically.

Also added `JSON` to the import line at the top of the file:
```python
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Enum, JSON, func
)
```

And added one line to the existing `Resume` class:
```python
parse = relationship("ResumeParse", back_populates="resume",
                     uselist=False, cascade="all, delete-orphan")
```

`uselist=False` is what tells SQLAlchemy "this is the singular side of a one-to-one, not a list."

**`backend/app/schemas.py`** — added Pydantic schemas:
```python
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
```

Notice we don't expose `raw_text` in the response — it's stored for debugging and as a fallback for future re-parses with different prompts, but the frontend doesn't need to render it.

**`backend/app/services/__init__.py`** — empty file, marks `services` as a Python package.

**`backend/app/services/resume_parser.py`** — new file, the parsing pipeline:
```python
import json
import pdfplumber
from anthropic import Anthropic
from app.config import settings


PARSE_PROMPT = """You are a resume parser. Extract the structured information
from the resume text below and return ONLY a valid JSON object with this exact
shape:

{
  "full_name": "string or null",
  "email": "string or null",
  ... (full schema in the actual file)
}

Rules:
- Return ONLY the JSON object, no preamble, no markdown, no code fences.
- Use null for any field you can't find. Never invent data.
- Empty arrays [] are fine for skills/work_experience/education if the
  resume has none.

Resume text:
---
{resume_text}
---"""


def extract_text_from_pdf(file_path: str) -> str:
    parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                parts.append(text)
    return "\n\n".join(parts)


def parse_resume_with_claude(resume_text: str) -> dict:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=settings.anthropic_api_key)
    prompt = PARSE_PROMPT.replace("{resume_text}", resume_text)

    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


def parse_pdf(file_path: str) -> tuple[dict, str]:
    raw_text = extract_text_from_pdf(file_path)
    if not raw_text.strip():
        raise ValueError("Could not extract any text from the PDF")
    parsed = parse_resume_with_claude(raw_text)
    return parsed, raw_text
```

The fence-stripping logic exists because Claude occasionally wraps output in
```` ```json ```` despite being told not to. Cheaper to handle defensively than
to fight the model.

**`backend/app/routers/resumes.py`** — added two endpoints to the existing
file (Phase 2 already had list/upload/download/delete):

```python
from app.models import Resume, ResumeParse
from app.schemas import ResumeParseOut
from app.services.resume_parser import parse_pdf

@router.post("/{resume_id}/parse", response_model=ResumeParseOut)
def parse_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    resume = (db.query(Resume)
              .filter(Resume.id == resume_id, Resume.user_id == user.id)
              .first())
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    try:
        parsed, raw_text = parse_pdf(resume.file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parsing failed: {e}")

    existing = db.query(ResumeParse).filter(
        ResumeParse.resume_id == resume_id).first()
    if existing:
        db.delete(existing)
        db.flush()

    parse_row = ResumeParse(
        resume_id=resume_id,
        full_name=parsed.get("full_name"),
        # ... all other fields ...
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
    resume = (db.query(Resume)
              .filter(Resume.id == resume_id, Resume.user_id == user.id)
              .first())
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    parse_row = db.query(ResumeParse).filter(
        ResumeParse.resume_id == resume_id).first()
    if not parse_row:
        raise HTTPException(status_code=404, detail="Resume not parsed yet")
    return parse_row
```

POST is "parse this and return the result." GET is "give me the existing parse, or 404 if it hasn't been parsed yet." The frontend uses GET to decide whether to show "Parse" or "Re-parse" on the button, and POST to actually trigger the work.

The upsert pattern (delete the existing row, flush, insert a new one) is intentionally simple. We could've used `db.merge()` or a manual `ON CONFLICT` upsert, but delete+insert is the easiest to reason about and the parse table is tiny — no performance concern.

### Frontend

**`frontend/src/app/resumes/page.tsx`** — new file, list + upload page. Uses
`apiFetch` from Phase 2's shared helper. Multipart upload via `FormData`.
Shows uploaded resumes with delete buttons; each row links to the detail
page. Restricts uploads to PDFs (the input has `accept="application/pdf"`)
and validates that both a label and file are present before enabling the
upload button.

**`frontend/src/app/resumes/[id]/page.tsx`** — new file, the detail/parse
view. On mount it tries to GET the parse; if the response is "not parsed
yet" it shows a button instead of an error. Clicking "Parse this resume"
fires the POST, waits for it to come back (5–15 seconds typically), and
renders the structured output in cards: Contact, Summary, Skills (as
chips), Experience (with bullets), Education. The same button becomes
"Re-parse" once a parse exists.

**`frontend/src/app/dashboard/page.tsx`** — added one `<Link>` next to the
"+ New" button so the dashboard has a way into the new page:
```tsx
<Link href="/resumes" className="border px-3 py-2 rounded text-sm">
  Resumes
</Link>
```

### Infrastructure

**`docker-compose.yml`** — added `ANTHROPIC_API_KEY` to the `backend.environment`
block so the container picks up the key from the root `.env` at compose time.

**Root `.env`** — filled in `ANTHROPIC_API_KEY=sk-ant-...` with the real key
from console.anthropic.com.

### Migration

**`backend/alembic/versions/<NEW>_add_resume_parses_table.py`** — generated
via `alembic revision --autogenerate`. Creates the `resume_parses` table
with the unique constraint on `resume_id`. (This file exists on disk but
hasn't been applied to a working database yet — see "Where we got stuck"
below.)

---

## What's running right now

- Same Phase 2 stack: Postgres + pgvector on 5432, FastAPI on 8000, Next.js on 3000.
- All code from Phase 3 is on disk.
- Frontend dashboard now shows a "Resumes" button next to "+ New".
- `/api/v1/health` returns 200 OK — backend is alive.
- `/api/v1/applications` returns 500 — database has no `applications` table.

---

## Where we got stuck

The database state went sideways during Phase 3 testing. At some point a
`docker compose down -v` ran, which deletes the named volume `jobtrackr_db_data`
and wipes Postgres entirely. After bringing the stack back up, only the
`alembic_version` table existed — meaning Postgres had restarted from a
truly empty state.

The recovery sequence should have been:

1. `cd frontend && npx prisma migrate deploy && cd ..` — creates `users`,
   `accounts`, `sessions`, `verification_tokens` (Prisma's tables).
2. `docker compose exec backend alembic upgrade head` — creates Phase 2 +
   Phase 3 tables, all of which reference `users` via foreign keys.

But step 1 reports "No pending migrations to apply" even on a fresh empty
database. That's wrong. On an empty DB, Prisma should detect that nothing
has been applied and run all migrations. Instead it short-circuits.

The likely cause: a mismatch between the database that `frontend/.env`'s
`DATABASE_URL` points at and the database the backend container talks to.
Possibilities to check on resume:

1. `frontend/.env` has `DATABASE_URL` pointing at `localhost:5432` (from the
   Mac's perspective, which is correct since `npx prisma` runs on the host),
   and root `.env` has it pointing at `db:5432` (correct for the backend
   container's perspective inside the Docker network). If `frontend/.env`
   accidentally uses `db:5432`, Prisma can't connect at all and may be
   reading some stale state from `node_modules`.

2. There's a second Postgres running somewhere (Homebrew? An old Docker
   stack with a different project name?) that Prisma is connecting to,
   while our compose stack is on a different one. `lsof -i :5432` would
   reveal this.

3. Prisma's local migration shadow database is confused. Running
   `npx prisma migrate reset --force --skip-seed` from `frontend/` should
   force a clean re-apply.

The fastest way to unstick this when picking up: run option 3 first, then
re-run `alembic upgrade head`. If option 3 also says "no pending," dig into
options 1 and 2.

---

## Commands used during Phase 3

For future reference, here's everything that ran (or should have run) in
order. Commented lines with `# FAILED` are the ones that didn't complete
successfully and need re-running on resume.

```bash
# 1. Backend deps + image rebuild
# (edit backend/requirements.txt: add anthropic, pdfplumber)
docker compose build backend

# 2. Env var wiring
# (edit root .env: add ANTHROPIC_API_KEY=sk-ant-...)
# (edit docker-compose.yml: add ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
#    under backend.environment)
# (edit backend/app/config.py: add anthropic_api_key: str = "")

# 3. Schema additions
# (edit backend/app/models.py: add ResumeParse class, JSON import,
#    parse relationship on Resume)
# (edit backend/app/schemas.py: add WorkExperience, Education,
#    ResumeParseOut)

# 4. Service layer
mkdir -p backend/app/services
touch backend/app/services/__init__.py
# (create backend/app/services/resume_parser.py — pdfplumber + Claude
#    pipeline)

# 5. Router additions
# (edit backend/app/routers/resumes.py: add 3 imports, 2 endpoints)

# 6. Migration
docker compose up -d
docker compose exec backend alembic revision --autogenerate \
    -m "add resume_parses table"
docker compose exec backend alembic upgrade head

# 7. Frontend
# (create frontend/src/app/resumes/page.tsx)
# (create frontend/src/app/resumes/[id]/page.tsx)
# (edit frontend/src/app/dashboard/page.tsx: add Resumes link)

# 8. Local Pylance fix (cosmetic, optional)
cd backend
source .venv/bin/activate
pip install pdfplumber anthropic
deactivate
cd ..

# --- THINGS WENT SIDEWAYS HERE ---
# Database got wiped (docker compose down -v ran somewhere)
# Recovery attempted:

docker compose down -v                      # wiped DB + volume
docker compose up -d db
sleep 5
cd frontend && npx prisma migrate deploy && cd ..   # FAILED: "No pending migrations to apply"
docker compose up -d backend
sleep 5
docker compose exec backend alembic upgrade head    # FAILED: relation "users" does not exist

# To resume, the right next command is:
cd frontend && npx prisma migrate reset --force --skip-seed && cd ..
docker compose exec backend alembic upgrade head

# Then verify:
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 11 tables — accounts, alembic_version, applications, contacts,
#   interview_rounds, notes, _prisma_migrations, resume_parses, resumes,
#   sessions, users, verification_tokens
```

---

## What Phase 3 means in plain terms (once it works)

A user uploads a PDF and Claude turns it into structured data. That's the
whole user-visible feature. But what it really gives you is the **first AI
surface** in the app and **the first piece of structured profile data** that
every downstream feature can lean on. Resume tailoring per job posting,
interview prep that knows your background, semantic matching between your
experience and a JD, application analytics segmented by your skills — all
of it reads from `resume_parses`.

The schema decision that mattered most was making the structured arrays
JSON instead of separate tables. A future-you might be tempted to normalize
`work_experience` into a `work_experiences` table with a one-to-many to
`resume_parses`. Don't, unless you have a specific query that needs it.
JSON is faster to iterate on while we're still tuning the prompt and figuring
out what the AI features actually need.

---

## What's next

Once the migration mess is cleaned up and the parse flow tested
end-to-end, Phase 4 is "AI on the application side": paste a job
description into a new application, get back extracted requirements,
seniority level, tech stack, and red flags — stored in a new
`application_insights` table. After that comes the first feature that
combines both sides — resume-to-JD matching — which is where pgvector
finally earns its keep.