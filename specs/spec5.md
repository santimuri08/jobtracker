# Phase 5 — Cover Letter Generator & Bullet Rewriter

## What Phase 5 set out to do

Phase 4 built the AI substrate (a reusable Claude wrapper, a service-layer pattern, a router pattern, a test mock pattern, cost telemetry) and proved it on the gap analysis feature. Phase 5's job was to demonstrate the substrate by adding two more end-user AI features with as little new infrastructure as possible:

1. **Cover letter generator** — given an application (with a job description) and a parsed resume, Claude writes a tailored cover letter. The user can edit the result inline, save versions, switch which version is "active," copy to clipboard, and delete versions.

2. **Bullet rewriter** — given a single resume bullet plus the application's job description, Claude returns three rewrites in different styles: an impact-focused version, a concise version, and an ATS-keyword-friendly version. The user picks one (or none) and copies it out — nothing persists.

The "done when" criteria were: a logged-in user opens an application that has a JD and a parsed resume, generates a cover letter (~10 seconds), edits it, saves the edit, generates a second version, switches active versions, and refreshes the page to confirm everything persisted; on the same page, pastes any bullet, gets three labeled variants, copies one, and refreshes to confirm the variants are *not* persisted (intentional). All of that now works.

The point of Phase 5 wasn't really these two features — it was to **prove that the Phase 4 substrate delivers what it promised**: that adding a new AI feature is mostly prompt engineering and UI work, not plumbing. It did.

---

## The mental model

Phase 5 introduces no new infrastructure. Every piece of new code falls into one of the three layers Phase 4 established:

**Layer 1 — `claude_client.py` (reusable, not touched).** The Anthropic SDK wrapper from Phase 4. `call_claude_json(system, user, max_tokens)` is the only function any AI feature calls. Token logging, cost calculation, fence-stripping, JSON parsing — all already there.

**Layer 2 — two new service files (specific to each feature):**
- `services/cover_letter.py` — `SYSTEM_PROMPT`, `USER_TEMPLATE`, one function `run_cover_letter(...)` that formats the template and calls `call_claude_json`.
- `services/bullet_rewriter.py` — same shape: `SYSTEM_PROMPT`, `USER_TEMPLATE`, `run_bullet_rewrite(...)`.

**Layer 3 — two new routers (HTTP layer):**
- `routers/cover_letters.py` — five endpoints (list / generate / get / patch / delete) nested under an application.
- `routers/bullet_rewrites.py` — one endpoint, top-level (not nested), no DB persistence at all.

The data model split is the only structural decision worth thinking about. **Cover letters get a table** because users iterate on them (save the good one, generate a different one, compare). **Bullet rewrites do not get a table** because once the user picks one, they paste it into their resume (outside this app) and the suggestions are spent. Persisting them would mean another table, another router, more state to manage in the UI, all for a feature where the "save" action is conceptually meaningless.

The cover-letter table is the first one in the project that's **many-per-parent**. Phase 3's `resume_parses` and Phase 4's `gap_analyses` are both one-per-parent (with `unique=True` on the FK). Cover letters are the first many-to-one — multiple drafts per application, with one of them flagged `is_active`. There's no DB-level "only one active per application" constraint; the router enforces it by clearing `is_active=False` on siblings when one is set active. Could be tightened with a partial unique index later, but the current pattern is simpler and atomic enough for our scale.

---

## What's running right now

Same Phase 4 stack: Postgres+pgvector on 5432, FastAPI on 8000, Next.js on 3000. One new table (`cover_letters`), four new backend files, two new test files, one updated frontend file (the application detail page now hosts two new cards alongside the existing gap analysis card).

The full cover-letter round trip:

User on `/applications/{id}` → sees the cover-letter card → optionally types a tone ("enthusiastic") and extra instructions → clicks "Generate" → frontend POSTs to `http://localhost:8000/api/v1/applications/{id}/cover-letters` with the JWT and an empty body → router validates: app exists and belongs to user, app has `job_description`, app has `resume_id`, that resume has a `ResumeParse` row → router builds a slim resume dict (only user-visible fields, no `raw_text`) → calls `run_cover_letter(...)` → that calls `call_claude_json(system=..., user=...)` → SDK call to `claude-sonnet-4-5`, ~8–15 seconds → Claude returns `{"content": "..."}`, parsed to dict, token cost logged → router checks `existing_count` for this application; if 0, the new row is auto-`is_active=True` and labeled "Draft 1"; otherwise `is_active=False` and labeled "Draft N+1" → returns the row → frontend reloads the version list, sets the new one active locally, exits any edit mode.

The bullet-rewriter round trip is shorter:

User pastes a bullet → clicks "Rewrite" → frontend POSTs to `http://localhost:8000/api/v1/bullet-rewrites` with `{bullet, job_description}` → router calls `run_bullet_rewrite(...)` → service formats prompt and calls `call_claude_json` → Claude returns `{"variants": [{...}, {...}, {...}]}` → router validates exactly three came back, wraps them in `BulletRewriteOut`, returns → frontend renders three labeled cards. No DB writes. Closing or refreshing the page wipes the result.

Every endpoint enforces `application.user_id == current_user.id` (cover letters, via the `_get_app_or_404` helper) or just requires authentication (bullet rewriter, since it's not tied to any application — the user pastes whatever bullet they want).

---

## File-by-file walkthrough

### Backend

**`backend/app/models.py`** (modified)

Three small edits:

1. Added `Boolean` to the `sqlalchemy` import line. (`is_active` is a bool column on the new table.)
2. Inside the `Application` class, added one relationship line:
   ```python
   cover_letters = relationship(
       "CoverLetter",
       back_populates="application",
       cascade="all, delete-orphan",
       order_by="CoverLetter.created_at.desc()",
   )
   ```
3. At the bottom of the file, the new model:
   ```python
   class CoverLetter(Base):
       __tablename__ = "cover_letters"

       id = Column(Integer, primary_key=True)
       application_id = Column(
           Integer, ForeignKey("applications.id", ondelete="CASCADE"),
           nullable=False, index=True,
       )

       content = Column(Text, nullable=False)
       version_label = Column(String, nullable=True)   # e.g. "Draft 1", "Final"
       is_active = Column(Boolean, nullable=False, default=False)

       generator_version = Column(String, nullable=False, default="claude-v1")
       created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
       updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                           onupdate=func.now(), nullable=False)

       application = relationship("Application", back_populates="cover_letters")
   ```

`application_id` is `index=True` (not `unique=True`, deliberately — many letters per application). Cascade delete via FK (`ondelete="CASCADE"`) and via SQLAlchemy (`cascade="all, delete-orphan"`) — same belt-and-suspenders pattern as Phase 2.

**`backend/app/schemas.py`** (modified)

Five new Pydantic schemas appended at the bottom:

```python
class CoverLetterGenerateIn(BaseModel):
    tone: str | None = None
    extra_instructions: str | None = None

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

class BulletRewriteIn(BaseModel):
    bullet: str
    job_description: str | None = None

class BulletVariant(BaseModel):
    style: str        # "impact" | "concise" | "ats"
    text: str
    rationale: str | None = None

class BulletRewriteOut(BaseModel):
    original: str
    variants: list[BulletVariant]
```

`CoverLetterGenerateIn` is the POST body — both fields optional; the user can generate a letter without specifying anything. `CoverLetterUpdate` is the PATCH body — `model_dump(exclude_unset=True)` in the router means only the fields the client actually sent get written. `BulletRewriteOut` is *not* an `ORMModel` because it never reads from a DB row — the router constructs it manually from Claude's response.

**`backend/app/services/cover_letter.py`** (new)

The same shape as Phase 4's `gap_analysis.py`. A `SYSTEM_PROMPT` describing the role ("expert career coach"), the rules ("3 to 5 paragraphs, 250–400 words, lead with a hook, never invent skills, no boilerplate signoff, return strict JSON"), and a `USER_TEMPLATE` with `{resume_json}`, `{job_description}`, `{company}`, `{role}`, `{tone}`, `{extra_instructions}` placeholders that gets formatted via Python `.format()`. The double curly braces `{{` and `}}` in the JSON example escape Python's format syntax.

The function:

```python
def run_cover_letter(
    *,
    resume_parse: dict,
    job_description: str,
    company: str,
    role: str,
    tone: str | None = None,
    extra_instructions: str | None = None,
) -> dict[str, Any]:
    if not resume_parse:
        raise ValueError("Resume parse is empty")
    if not job_description or not job_description.strip():
        raise ValueError("Job description is empty")

    user_prompt = USER_TEMPLATE.format(
        resume_json=json.dumps(resume_parse, ensure_ascii=False, indent=2),
        job_description=job_description.strip(),
        company=company or "(not specified)",
        role=role or "(not specified)",
        tone=tone or "(default: confident but warm)",
        extra_instructions=extra_instructions or "(none)",
    )

    return call_claude_json(system=SYSTEM_PROMPT, user=user_prompt, max_tokens=2048)
```

Pure Python, no I/O, no Anthropic imports, no env vars. The function is therefore trivially mockable in tests.

**`backend/app/services/bullet_rewriter.py`** (new)

Same shape, smaller scope. `SYSTEM_PROMPT` describes the three styles in detail (`impact`, `concise`, `ats`) and the hard rules (don't invent metrics, each variant must be a faithful rewrite of the *same* accomplishment, return strict JSON). `USER_TEMPLATE` shows the exact JSON schema with three named variants. `max_tokens=1024` because the output is small.

**`backend/app/routers/cover_letters.py`** (new)

Five endpoints under `/api/v1/applications/{application_id}/cover-letters`:

```
GET    ""            → list_cover_letters     (newest first)
POST   ""            → generate_cover_letter  (returns 201)
GET    "/{letter_id}" → get_cover_letter
PATCH  "/{letter_id}" → update_cover_letter   (content, version_label, is_active)
DELETE "/{letter_id}" → delete_cover_letter   (returns 204)
```

The `_get_app_or_404` helper pattern from earlier phases is reused. POST does the same validation cascade as Phase 4's gap analysis: app exists and is yours (404), app has `job_description` (400), app has `resume_id` (400), that resume has a `ResumeParse` (400). The error code distinction matters: 502 means "the AI screwed up your request was fine," 500 means "something broke on our side," 400 means "your application isn't ready yet."

The interesting bit is the active-flag enforcement on PATCH:

```python
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
```

This is one transaction: clear all siblings, set this one, commit. Race-free at our scale (one user updating their own letters). For a multi-user-shared-record scenario this would deserve a partial unique index (`CREATE UNIQUE INDEX ... WHERE is_active`), but we don't have that case.

The auto-labeling logic on POST:

```python
existing_count = (
    db.query(CoverLetter)
    .filter(CoverLetter.application_id == application_id)
    .count()
)
is_active = existing_count == 0
label = f"Draft {existing_count + 1}"
```

First letter ever for this app becomes "Draft 1" + active. Second becomes "Draft 2" + not-active. The user explicitly picks which one to make active later — generating a new draft never silently steals the active flag from the user's hand-edited preferred version.

**`backend/app/routers/bullet_rewrites.py`** (new)

One endpoint, top-level: `POST /api/v1/bullet-rewrites`. Not nested under any application — the user can paste any bullet from anywhere. Auth still required (`Depends(get_current_user)`).

```python
@router.post("", response_model=BulletRewriteOut)
def rewrite_bullet(payload: BulletRewriteIn, user: CurrentUser = Depends(get_current_user)):
    try:
        result = run_bullet_rewrite(
            bullet=payload.bullet,
            job_description=payload.job_description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")

    raw_variants = result.get("variants") or []
    if len(raw_variants) != 3:
        raise HTTPException(status_code=502, detail=f"Expected 3 variants, got {len(raw_variants)}")

    variants = [
        BulletVariant(style=v.get("style", "?"), text=v.get("text", ""), rationale=v.get("rationale"))
        for v in raw_variants
    ]
    return BulletRewriteOut(original=payload.bullet, variants=variants)
```

The "exactly 3 variants" check is the one assertion this router makes about Claude's output — if the model ever drifts and returns 2 or 4, the endpoint surfaces it as a 502 instead of returning malformed data to the frontend. No DB calls anywhere in this file.

**`backend/app/main.py`** (modified)

Two-line change. `cover_letters` and `bullet_rewrites` added to the `from app.routers import (...)` block, and two `app.include_router(...)` calls at the bottom.

**`backend/alembic/versions/ef94b50389b6_add_cover_letters_table.py`** (generated)

Autogenerated migration. Creates `cover_letters` with the FK to `applications.id` (CASCADE on delete) and the index on `application_id`. Downgrade drops the index then the table. The autogenerate run was clean — no surprise drops or alters of other tables, no false positives. (Phase 4 had to fix `_prisma_migrations` getting flagged for drop; that filter is still in place from Phase 4 and continues to work.)

**`backend/tests/conftest.py`** (modified)

The `mock_claude` fixture from Phase 4 already patched `claude_client` and `gap_analysis`. Phase 5 adds two more patches:

```python
import app.services.cover_letter as cover_mod
import app.services.bullet_rewriter as bullet_mod
monkeypatch.setattr(cover_mod, "call_claude_json", _fake_call)
monkeypatch.setattr(bullet_mod, "call_claude_json", _fake_call)
```

The reason for the per-module patch (instead of patching `claude_client` once) is unchanged from Phase 4: each service does `from app.services.claude_client import call_claude_json`, which copies the function reference into the importing module's namespace. Patching only the source module doesn't affect the already-imported references. Every future AI service needs its own line in this fixture.

**`backend/tests/test_cover_letter.py`** (new)

Four tests:

- `test_post_unauthenticated` — POST without a token returns 401
- `test_get_unauthenticated` — GET without a token returns 401
- `test_run_cover_letter_returns_mock` — feeds canned `{"content": "..."}` through `mock_claude` and asserts the function returns it
- `test_run_cover_letter_rejects_empty_jd` — confirms `ValueError` is raised when JD is empty

**`backend/tests/test_bullet_rewriter.py`** (new)

Three tests:

- `test_post_unauthenticated` — POST without a token returns 401
- `test_run_bullet_rewrite_returns_three_variants` — feeds canned 3-variant JSON, asserts the styles are `{impact, concise, ats}`
- `test_run_bullet_rewrite_rejects_empty` — confirms `ValueError` on empty bullet

Total test count after Phase 5: **16 passing** (was 9 after Phase 4, +7 here).

### Frontend

**`frontend/src/app/applications/[id]/page.tsx`** (modified)

The single biggest file change in Phase 5. Three additions to the existing application detail page:

1. **New types** at the top of the file: `CoverLetter`, `BulletVariant`, `BulletRewriteResult`. (The existing `AppDetail`, `Round`, `Contact`, `Note`, `ExperienceGap`, `GapAnalysis` types are unchanged.)

2. **Two new render blocks** in the JSX, placed right after the existing `<GapAnalysisCard>` block, both wrapped in the same `session?.backendToken &&` guard:
   ```tsx
   {session?.backendToken && (
     <CoverLetterCard
       applicationId={String(appData.id)}
       token={session.backendToken}
       hasJobDescription={!!appData.job_description}
       hasResume={!!appData.resume_id}
     />
   )}
   {session?.backendToken && (
     <BulletRewriterCard
       jobDescription={appData.job_description}
       token={session.backendToken}
     />
   )}
   ```

3. **Two new component definitions** outside the default export, alongside `GapAnalysisCard`:

   **`CoverLetterCard`** — full state machine. On mount, GET the list. Render version pills (each labeled by `version_label`, with a star ★ on the active one). Click a pill to switch the displayed letter (local UI state only). Click "Make active" to PATCH `is_active=true` (the router clears the others). The active letter has a toolbar: Make active (if not), Copy (writes to clipboard via `navigator.clipboard.writeText`), Edit (toggles a textarea), Delete (with `confirm()`). Edit mode shows a `<textarea rows={14}>` bound to a local `draft` state; Save fires PATCH with `{content: draft}`. Generate has two optional `<input>`s for tone and extra instructions; the button label changes from "Generate" → "Generate new draft" once at least one letter exists. Disabled with explanatory grey text if `!hasJobDescription || !hasResume`.

   **`BulletRewriterCard`** — much simpler. A `<textarea rows={3}>` bound to `bullet` state, a Rewrite button that POSTs and stores the result in component state, and conditional rendering of the three variants below. Each variant card has the style label (UPPERCASE, gray), the text, the rationale (italic gray), and a Copy button. No persistence — refreshing the page wipes everything.

`useCallback` was already imported from earlier phases; no import changes were needed.

The rest of the page (header, status dropdown, salary, JD details, gap analysis, interview rounds, contacts, notes, the existing `ContactAdder` and `NoteAdder` components) is unchanged.

### Infrastructure

No `docker-compose.yml`, `.env`, `requirements.txt`, or `package.json` changes. Phase 4's `anthropic>=0.40.0` is still pinned and still works. No new dependencies of any kind. The only new infrastructure surface is the migration file.

---

## How a typical request flows

When you click "Generate" on a fresh application's cover letter card:

1. Browser fires `POST http://localhost:8000/api/v1/applications/42/cover-letters` with `Authorization: Bearer <jwt>` and body `{"tone": "enthusiastic", "extra_instructions": null}`.
2. CORS preflight (`OPTIONS`) succeeds.
3. FastAPI routes to `cover_letters.generate_cover_letter`. Dependencies resolve: `db` from `get_db()`, `user` from `get_current_user(...)`.
4. `_get_app_or_404(db, 42, user.id)` confirms the app exists and is yours. 404 otherwise.
5. Validates `app.job_description` is truthy. 400 if not.
6. Validates `app.resume_id` is set. 400 if not.
7. Queries `ResumeParse` by `resume_id`. 400 if no parse exists yet.
8. `_resume_parse_dict(parse)` builds a slim dict — no `raw_text`, no DB metadata, just the user-visible fields the model needs.
9. Calls `run_cover_letter(...)`. Inside: format the user prompt with `tone="enthusiastic"`, `extra_instructions="(none)"`, etc. Calls `call_claude_json(system=..., user=...)`. The Anthropic SDK does an HTTP POST to `api.anthropic.com`. ~8–15 seconds round trip.
10. Claude returns `{"content": "Dear Acme team,\n\nWhen I saw..."}`. JSON parsed. Token usage logged: `claude call model=claude-sonnet-4-5 in_tok=1850 out_tok=425 cost_usd=0.0119 elapsed_ms=11823`.
11. Router strips whitespace from `content`. Counts existing letters for this application: 0. So `is_active=True`, `label="Draft 1"`.
12. New `CoverLetter` row created, committed, refreshed, returned. FastAPI serializes via `from_attributes=True`.
13. Browser receives the JSON. The card calls `load()` (re-fetches the list), sets `activeId` to the new letter's id, sets `draft` to its content, exits edit mode. The pill list updates and the active letter renders.

If anything fails: 401 (bad token), 404 (app not yours), 400 (validation), 502 (AI returned non-JSON or empty content), 500 (config error or unexpected exception).

The bullet rewriter flow is the same shape with two differences: no parent application validation (it's a top-level endpoint), no DB writes after Claude returns. The 502 path also fires if Claude doesn't return exactly three variants.

---

## Where we got stuck (or didn't)

Phase 5 was the smoothest phase since Phase 0. The Phase 4 substrate did its job — almost every step was a copy-paste-modify of a Phase 4 pattern. A few small things came up worth recording:

**Indentation got flattened in pasted code.** When the user pasted `main.py` into the chat for me to review, indentation collapsed (function bodies showed up at column 0). I noted that the actual file on disk was fine — just a paste artifact — and gave back the version with proper indentation restored. Worth flagging because it could trick someone into thinking the on-disk file is broken when it isn't.

**Migration autogenerate noise.** Alembic logged seven `Detected sequence named '..._id_seq' as owned by integer column ..., assuming SERIAL and omitting` lines during autogenerate. These are normal — Alembic noticing existing SERIAL primary keys on previously-created tables and choosing not to generate any DDL for them. The signal lines that mattered were `Detected added table 'cover_letters'` and `Detected added index 'ix_cover_letters_application_id'`, and those were both clean. Phase 3's instinct to *read every autogenerated migration before applying* was right and continues to be the discipline.

**JSX entity escaping.** The bullet rewriter card description originally had "this application's JD" which Next.js's strict mode flagged as an unescaped entity. Changed to `application&apos;s`. Cosmetic, not functional.

That's it. No DB recovery, no SDK incompatibilities, no hydration weirdness, no auth gotchas. Phase 4 absorbed all that pain so Phase 5 didn't have to.

---

## What's wired but dormant

Same list as Phase 4, all carried forward:

- **`ANTHROPIC_MODEL` env var still does nothing.** Phase 4 noted that `claude_client.py` hardcodes `claude-sonnet-4-5` and `.env`'s `ANTHROPIC_MODEL` is unread. Phase 5 added two more services that both inherit `claude_client.py`'s default, so the count is now: `resume_parser.py` hardcodes its own model, and three other services (`gap_analysis.py`, `cover_letter.py`, `bullet_rewriter.py`) all inherit `claude_client.py`'s `DEFAULT_MODEL`. When this gets fixed, do it in `claude_client.py` once (read `settings.anthropic_model` with a fallback) and `resume_parser.py` should be updated to use `call_claude_json` too.

- **No retry logic.** A 429 or transient 500 from Claude still fails the request. Three features now without retries instead of one. Wrapping `call_claude_json` with exponential backoff (3 retries, 1s/2s/4s) would cover all three at once.

- **No streaming.** Cover letter generation takes 10–15 seconds and is the longest-output feature so far. Streaming would let the UI show partial text as it's produced. Phase 6 (resume tailoring, output even longer) is the right place to introduce this — adding it now and again later means refactoring twice.

- **Cost telemetry is still stdout only.** Three features all logging `claude call ...` to `docker compose logs backend`. No `ai_calls` audit table. If you start needing per-user usage limits, per-feature cost attribution, or just "how much did Claude cost me last month," this is where it goes.

- **No "save bullet variant" feature.** Intentional. If a user finds themselves wanting it, that's a sign they actually want a separate "resume editor" feature, not a bolted-on save button on the rewriter.

---

## What Phase 5 means in plain terms

You now have three end-user AI features sharing one wrapper, one test fixture pattern, one error-shape convention, and one cost-logging line. The Phase 4 substrate paid off: Phase 5 was almost entirely "copy the gap-analysis pattern, change the prompt, change the schema, change the card."

The only structurally new thing in Phase 5 was the **list shape for cover letters** (one application → many letters, one is active). That's the first place the codebase will re-encounter that pattern when resume tailoring lands later, so the conventions established here (auto-labeling as "Draft N," router-enforced exclusivity of `is_active`, no auto-active-stealing on new generations) will get reused.

You haven't built any new infrastructure. You've shown that the infrastructure works.

---

## Commands run during Phase 5

For future reference / re-running on a fresh checkout. Assumes Phase 4 is already healthy.

```bash
# === Prerequisites — confirm Phase 4 still works ===
docker compose ps
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 12 tables including gap_analyses
docker compose exec backend python -c "from app.services.claude_client import call_claude_json; print('ok')"
docker compose exec backend python -c "from app.services.gap_analysis import run_gap_analysis; print('ok')"
docker compose exec backend pytest -v
# Expected: 9 tests pass

# === PHASE 5 PROPER ===

git checkout main
git pull
git checkout -b phase-5-cover-letter-bullet-rewriter

# 1. Data model — edit backend/app/models.py
#    a) Add Boolean to the sqlalchemy import
#    b) Add `cover_letters = relationship(...)` inside Application class
#    c) Add CoverLetter class at bottom
docker compose exec backend python -c "from app.models import CoverLetter, Application; print('ok')"

# 2. Pydantic schemas — edit backend/app/schemas.py
#    Append CoverLetterGenerateIn, CoverLetterUpdate, CoverLetterOut,
#    BulletRewriteIn, BulletVariant, BulletRewriteOut
docker compose exec backend python -c "from app.schemas import CoverLetterOut, CoverLetterUpdate, CoverLetterGenerateIn, BulletRewriteOut, BulletRewriteIn, BulletVariant; print('ok')"

# 3. Service layer — create two new files
#    backend/app/services/cover_letter.py
#    backend/app/services/bullet_rewriter.py
docker compose exec backend python -c "from app.services.cover_letter import run_cover_letter; print('ok')"
docker compose exec backend python -c "from app.services.bullet_rewriter import run_bullet_rewrite; print('ok')"

# 4. Routers — create two new files
#    backend/app/routers/cover_letters.py   (5 endpoints, nested under application)
#    backend/app/routers/bullet_rewrites.py (1 endpoint, top-level)
docker compose exec backend python -c "from app.routers.cover_letters import router; print('ok')"
docker compose exec backend python -c "from app.routers.bullet_rewrites import router; print('ok')"

# 5. Wire routers into main.py
#    Edit backend/app/main.py: add cover_letters and bullet_rewrites to import,
#    add two app.include_router(...) calls
docker compose restart backend
docker compose logs --tail=30 backend
# Expected: "Application startup complete." with no tracebacks

# Verify routes registered
curl -s http://localhost:8000/openapi.json | python3 -c "import json,sys; d=json.load(sys.stdin); paths=[p for p in d['paths'] if 'cover-letters' in p or 'bullet-rewrites' in p]; print('\n'.join(paths))"
# Expected:
#   /api/v1/applications/{application_id}/cover-letters
#   /api/v1/applications/{application_id}/cover-letters/{letter_id}
#   /api/v1/bullet-rewrites

# 6. Migration
docker compose exec backend alembic revision --autogenerate -m "add cover_letters table"
# REVIEW the new file under backend/alembic/versions/<hash>_add_cover_letters_table.py
# Confirm upgrade() only does create_table('cover_letters') + create_index.
# If it tries to drop or alter anything else, STOP and investigate.

docker compose exec backend alembic upgrade head
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 13 tables, cover_letters present
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\d cover_letters"
# Expected: 8 columns, FK to applications.id with ON DELETE CASCADE,
# index on application_id

# 7. Tests
#    Edit backend/tests/conftest.py (extend mock_claude with two new patch lines)
#    Create backend/tests/test_cover_letter.py
#    Create backend/tests/test_bullet_rewriter.py
docker compose exec backend pytest -v
# Expected: 16 passed (9 prior + 7 new)

# 8. Frontend
#    Edit frontend/src/app/applications/[id]/page.tsx:
#      - Add CoverLetter, BulletVariant, BulletRewriteResult types
#      - Add CoverLetterCard component
#      - Add BulletRewriterCard component
#      - Render both inside the page after the existing GapAnalysisCard
#    No new files, no package.json changes.

cd frontend && npm run dev
# Expected: clean compile, "Ready in ..."

# 9. End-to-end browser test (use Chrome, not Safari)
#    - Log in
#    - Open an application that has BOTH a job description AND a linked, parsed resume
#    - Cover letter:
#        click Generate, wait 8-15s, see "Draft 1" pill marked active (★)
#        click Edit, change something, Save, refresh — edit persists
#        click Generate new draft → "Draft 2" appears, Draft 1 still active
#        click Draft 2 pill → Make active → ★ moves
#        Copy / Delete buttons work
#    - Bullet rewriter:
#        paste a sentence, click Rewrite, wait 5-10s
#        see three variants: IMPACT / CONCISE / ATS, each with Copy
#        refresh page → variants gone (intentional, not persisted)
#    - Watch `docker compose logs -f backend` for cost telemetry lines

# 10. Commit
docker compose exec backend pytest -v          # final green check
git add .
git commit -m "Phase 5: cover letter generator + bullet rewriter"
git push -u origin phase-5-cover-letter-bullet-rewriter
```

---

## What's next

**Phase 6 — Resume tailoring.** First feature where streaming earns its keep — the output is long enough that letting the user watch it stream beats waiting 20 seconds with a spinner. Probably also the first feature that uses `pgvector` for real: semantic similarity between the job description and individual resume bullets, so the AI knows which bullets to rewrite vs. leave alone. New `tailored_resumes` table per (application, resume) pair, similar shape to `cover_letters` but with a `tailored_bullets` JSON column or a separate child table for line-level diffs.

The substrate from Phase 4 will continue to do its job. New service file with prompt + template + one function calling `call_claude_json`. New router with the same try/except shape. New model with JSON columns. New `mock_claude` patch line in `conftest.py`. New frontend card with a streaming variant of the same render-the-result pattern.

After Phase 6, the AI feature set is essentially complete. Phase 7+ is cross-cutting concerns: an `ai_calls` audit table, retry/streaming wrappers, application analytics that aggregate fit scores over time, email/calendar integration. None of those reshape the AI substrate — they sit on top of it or beside it.

The hard infrastructure work has stayed done since Phase 4. Phase 5 confirmed it.