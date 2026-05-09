# Phase 4 — Gap Analysis (First AI Feature)

## What Phase 4 set out to do

Phases 1–3 built identity, the data layer, and the first AI surface (resume parsing). Phase 4 was the first **end-user AI feature**: a button on each application that compares the user's parsed resume against the job description and returns a structured gap analysis — fit score, matched skills, missing skills, experience gaps, recommendations.

Gap analysis was chosen first because it's the simplest Claude integration in the roadmap: one prompt, one structured JSON response, persist to one new table, render in one new card. The actual business logic is small. The point of Phase 4 wasn't to ship that feature — it was to **build the patterns every future AI feature reuses**: a wrapper around the Anthropic SDK, structured JSON parsing, token/cost logging, mocked tests, error semantics for AI calls. Phase 5 (interview prep) and Phase 6 (resume tailoring) become copy-paste-modify because of the work done here.

The "done when" criteria were: a logged-in user with a parsed resume and an application that has a job description clicks "Run gap analysis," waits ~10 seconds, and sees structured feedback rendered on the page; re-running replaces the row instead of appending; refreshing the page reloads the saved result. All three now work.

---

## The mental model

Phase 4 introduces three layers that didn't exist before, in increasing specificity:

**Layer 1 — `claude_client.py` (reusable for every AI feature).** This is a thin wrapper around the Anthropic SDK. It takes a `system` prompt, a `user` prompt, calls Claude in JSON mode, strips code fences if Claude wraps the output in ```` ```json ```` despite being told not to, parses the JSON, and logs token usage + estimated cost to stdout. Every future AI feature calls this and never touches the SDK directly.

**Layer 2 — `gap_analysis.py` (specific to this feature).** Pure Python: takes a parsed-resume dict and a job-description string, formats them into a system + user prompt pair, calls `call_claude_json`, returns the dict. No I/O, no Anthropic imports, no env vars. Easy to mock in tests.

**Layer 3 — `routers/gap_analyses.py` (HTTP layer).** The two endpoints that mount the feature on the API. POST runs the analysis (with full input validation: app exists, app belongs to user, job description present, resume linked, resume parsed). GET returns the saved analysis or 404. Upsert pattern: delete + flush + insert, same as Phase 3.

The data model is a new table `gap_analyses` with a one-to-one relationship to `applications`. Top-level scalars (`fit_score`, `summary`) are real columns; structured arrays (`matched_skills`, `missing_skills`, `experience_gaps`, `recommendations`) are JSON columns, same pattern as Phase 3's `resume_parses`. Re-running deletes the existing row and inserts a new one — no append, no version history.

---

## What's running right now

Same Phase 3 stack: Postgres+pgvector on 5432, FastAPI on 8000, Next.js on 3000. One new table (`gap_analyses`), three new backend files, one new frontend card, one updated form. The `anthropic` SDK was upgraded from 0.39.0 to 0.100.0 to fix an `httpx` incompatibility (details below).

The full gap-analysis round trip:

User on `/applications/{id}` → clicks "Run gap analysis" → frontend POSTs to `http://localhost:8000/api/v1/applications/{id}/gap-analysis` with the JWT → router validates: app exists and belongs to user, app has `job_description`, app has `resume_id`, that resume has a `ResumeParse` row → router builds a dict from the parse (only user-visible fields, not `raw_text`) → calls `run_gap_analysis(resume_dict, job_description)` → that calls `call_claude_json(system=..., user=...)` → SDK call to `claude-sonnet-4-5`, ~5–15 seconds → JSON parsed, token cost logged → router upserts a `GapAnalysis` row → returns the row → frontend renders fit score, chips, gaps, recommendations.

Every endpoint enforces `application.user_id == current_user.id`. There's no path where one user can analyze another user's data.

---

## File-by-file walkthrough

### Backend

**`backend/app/services/claude_client.py`** (new, the most important file in Phase 4)

The reusable wrapper. Exports one function:

```python
def call_claude_json(*, system: str, user: str, max_tokens: int = 2048,
                    model: str = DEFAULT_MODEL) -> dict[str, Any]:
```

Internals: instantiates `Anthropic(api_key=settings.anthropic_api_key)`, calls `client.messages.create(...)`, reads `message.content[0].text`, strips ```` ``` ```` fences if present, `json.loads`. On non-JSON output it raises `ValueError` with the first 200 characters of what came back (enough to debug, not enough to flood logs). On missing API key it raises `RuntimeError`. Token logging is a single line: `claude call model=... in_tok=N out_tok=M cost_usd=X elapsed_ms=Y`. The cost numbers (`$3/1M input, $15/1M output`) are hardcoded constants — update if pricing changes.

The `system`/`user` split (instead of jamming everything into one user message like Phase 3's `resume_parser.py` did) is the small upgrade that makes this reusable. Every future AI feature will want its own system prompt.

**`backend/app/services/gap_analysis.py`** (new)

Two top-level constants and one function. `SYSTEM_PROMPT` tells Claude it's a recruiter doing a gap analysis, must return strict JSON, must be honest but constructive, and must not mark equivalent skills as missing (e.g., don't say "PostgreSQL is missing" if the resume lists "Postgres"). `USER_TEMPLATE` is the exact JSON schema Claude must emit, with `{resume_json}` and `{job_description}` placeholders. The double curly braces `{{` and `}}` in the template escape JSON braces from Python's `.format()`.

```python
def run_gap_analysis(resume_parse: dict, job_description: str) -> dict:
    if not job_description.strip(): raise ValueError("Job description is empty")
    if not resume_parse: raise ValueError("Resume parse is empty")
    user_prompt = USER_TEMPLATE.format(
        resume_json=json.dumps(resume_parse, ensure_ascii=False, indent=2),
        job_description=job_description.strip(),
    )
    return call_claude_json(system=SYSTEM_PROMPT, user=user_prompt, max_tokens=2048)
```

That's the entire pipeline. Phase 5 (`interview_prep.py`) and Phase 6 (`resume_tailoring.py`) will look identical: a system prompt, a user template, one function calling `call_claude_json`.

**`backend/app/models.py`** (modified)

Added one new class at the bottom:

```python
class GapAnalysis(Base):
    __tablename__ = "gap_analyses"
    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id", ondelete="CASCADE"),
                            nullable=False, unique=True)
    fit_score = Column(Integer, nullable=True)              # 0-100
    matched_skills = Column(JSON, nullable=True)
    missing_skills = Column(JSON, nullable=True)
    experience_gaps = Column(JSON, nullable=True)
    recommendations = Column(JSON, nullable=True)
    summary = Column(Text, nullable=True)
    analyzer_version = Column(String, nullable=False, default="claude-v1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    application = relationship("Application", back_populates="gap_analysis")
```

`unique=True` on `application_id` enforces the one-to-one rule at the DB level. Cascade delete means deleting an application drops its analysis. JSON columns for the structured arrays (same pattern as `ResumeParse`) so the prompt schema can evolve without a migration.

Also added one line to the existing `Application` class:

```python
gap_analysis = relationship("GapAnalysis", back_populates="application",
                            uselist=False, cascade="all, delete-orphan")
```

**`backend/app/schemas.py`** (modified)

Added Pydantic schemas:

```python
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
```

Also fixed a Phase 3 schema-drift bug discovered during Phase 4 testing: `ResumeOut` had `mime_type` and `file_size`, but the actual DB columns (after the schema-drift migration earlier in Phase 3) are `content_type` and `size_bytes`. Changed those two fields. The frontend doesn't display either, so no frontend change needed.

**`backend/app/routers/gap_analyses.py`** (new)

Two endpoints under `/api/v1/applications/{application_id}/gap-analysis`:

```python
@router.post("", response_model=GapAnalysisOut)
def create_gap_analysis(application_id: int, db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
```

POST validates in this order: app exists and is user's (404 if not); app has `job_description` (400); app has `resume_id` (400); that resume has a `ResumeParse` row (400). Then builds a dict from `ResumeParse` (selecting only the user-visible fields — no `raw_text`, no DB metadata), calls `run_gap_analysis`. Wraps the call in try/except: `ValueError` → 502 ("AI returned bad output"), `RuntimeError` → 500 (config issue, missing API key), bare `Exception` → 500 catch-all. Then upserts: `db.delete(existing); db.flush(); db.add(new)`.

```python
@router.get("", response_model=GapAnalysisOut)
```

GET checks app ownership (404 if not user's), returns the row or 404 if no analysis exists yet. The frontend uses GET to decide whether the button says "Run gap analysis" or "Re-run analysis."

The 502 vs 500 distinction matters: 502 means "your request was fine but the upstream AI screwed up," 500 means "something on our side is broken." Phase 5/6 routers should use the same shape.

**`backend/app/main.py`** (modified)

Added `gap_analyses` to the import line and one `app.include_router(gap_analyses.router)` call. Two-line change.

**`backend/tests/conftest.py`** (new)

Shared pytest fixture that mocks `call_claude_json`. The trick: `gap_analysis.py` does `from app.services.claude_client import call_claude_json`, which copies the function reference into the `gap_analysis` module's namespace. Patching only `claude_client` won't affect the already-imported reference. So the fixture patches `monkeypatch.setattr(client_mod, "call_claude_json", ...)` AND `monkeypatch.setattr(gap_mod, "call_claude_json", ...)`. Every future AI feature needs its own line in this fixture.

```python
@pytest.fixture
def mock_claude(monkeypatch):
    holder = {"response": {}}
    def _fake_call(*, system, user, max_tokens=2048, model=None):
        return holder["response"]
    def _set(response: dict):
        holder["response"] = response
        import app.services.claude_client as client_mod
        import app.services.gap_analysis as gap_mod
        monkeypatch.setattr(client_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(gap_mod, "call_claude_json", _fake_call)
    return _set
```

**`backend/tests/test_gap_analysis.py`** (new)

Three tests: POST without auth returns 401, GET without auth returns 401, and a service-layer test that uses `mock_claude` to feed canned JSON and asserts `run_gap_analysis` returns it intact. The third test is the important one — it proves the mock fixture works end-to-end so future tests can rely on it without burning API credits.

**`backend/requirements.txt`** (modified)

Bumped `anthropic==0.39.0` to `anthropic>=0.40.0`. (See "Where we got stuck" below — 0.39.0 has an `httpx` compatibility bug.)

**`backend/alembic/env.py`** (modified)

Added `_prisma_migrations` to the `include_object` filter. Without this, Alembic detects Prisma's tracker table as "removed from models" and tries to drop it on every autogenerate. (Discovered the hard way during Phase 4 prep — see "Where we got stuck.")

**`backend/alembic/versions/11f383897d1e_add_gap_analyses_table.py`** (generated)

The Phase 4 migration. Just creates `gap_analyses` with the unique constraint on `application_id` and the CASCADE FK to `applications.id`. Downgrade drops the table.

### Frontend

**`frontend/src/app/applications/new/page.tsx`** (modified)

Added a resume picker at the bottom of the form. On mount it fetches `/api/v1/resumes`, populates a `<select>`. Submitting includes `resume_id: number | null` in the POST body. If the user has no resumes, the dropdown is empty with helper text pointing them to the resumes section.

This was a hidden requirement: the original Phase 2 form didn't expose `resume_id` at all, so applications were always created with a null resume link. The Phase 4 router rejects (400) any application with no linked resume. So without this UI change, the gap analysis button would have been permanently disabled.

**`frontend/src/app/applications/[id]/page.tsx`** (modified)

Added `resume_id` to the `AppDetail` type, added two new types (`ExperienceGap`, `GapAnalysis`), added a `<GapAnalysisCard>` component embedded between the application header and the interview rounds section.

The card has its own state machine: on mount, GET the analysis (404 is fine — means none exists). Show a button labeled "Run gap analysis" (or "Re-run analysis" if one exists). Clicking POSTs and replaces local state. Disabled with explanatory text if the application has no job description, or has no linked resume. Renders fit score (big number), summary paragraph, green chips for matched skills, red chips for missing skills, bulleted gaps with bold requirements, bulleted recommendations.

**`frontend/src/app/layout.tsx`** (modified)

Added `suppressHydrationWarning` to `<html>` and `<body>`. Required because Grammarly's browser extension injects `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed` attributes into the body tag after server render but before React hydration. Without `suppressHydrationWarning`, React tears down hydration partially and click handlers on subordinate components silently fail to bind. Standard fix recommended by Next.js.

### Infrastructure

No `docker-compose.yml` changes. The `ANTHROPIC_API_KEY` environment variable was already wired through in Phase 3.

---

## How a typical request flows

When you click "Run gap analysis":

1. Browser fires `POST http://localhost:8000/api/v1/applications/42/gap-analysis` with `Authorization: Bearer <jwt>` and an empty body.
2. CORS preflight (`OPTIONS`) succeeds.
3. FastAPI routes to `gap_analyses.create_gap_analysis`. Dependencies resolve: `db` from `get_db()`, `user` from `get_current_user(...)` (decodes JWT, returns `CurrentUser(id=..., email=...)`).
4. `_get_app_or_404(db, 42, user.id)` runs `SELECT * FROM applications WHERE id=42 AND user_id='<user.id>'`. 404 if missing or not yours.
5. Validates `app.job_description` is truthy. 400 if not.
6. Validates `app.resume_id` is set. 400 if not.
7. Queries `ResumeParse WHERE resume_id=app.resume_id`. 400 if no parse row.
8. Builds `resume_dict` with selected fields from the parse.
9. Calls `run_gap_analysis(resume_dict, app.job_description)`. Inside: format the user prompt, call `call_claude_json(system=..., user=...)`. The Anthropic SDK does an HTTP POST to `api.anthropic.com`. ~5–15 seconds round trip.
10. Claude returns text. `_strip_code_fences` cleans it. `json.loads` parses. Token usage logged: `claude call model=... in_tok=1247 out_tok=389 cost_usd=0.0096 elapsed_ms=8421`.
11. Result returns to the router. Existing row (if any) gets `db.delete()` + `db.flush()`. New row created with all the JSON-serialized arrays.
12. `db.commit()`, `db.refresh()`, returned. FastAPI serializes via `from_attributes=True`.
13. Browser receives the JSON. The card re-renders.

If anything fails: 401 (bad token), 404 (app not yours), 400 (validation), 502 (AI returned non-JSON), 500 (anything else). Errors carry useful detail messages.

---

## Where we got stuck

Phase 4 went from "easy" to "took six hours" because the Phase 3 environment wasn't actually as healthy as the spec claimed. Most of the time was diagnosis. Worth recording so the next phase doesn't repeat them.

**The database was empty.**
The Phase 3 spec said gap analysis was working end-to-end, but the live DB had zero tables when Phase 4 began. Running `\dt` showed "Did not find any relations." Some earlier `docker compose down -v` had wiped the named volume `jobtrackr_db_data`, and nothing rebuilt it. Recovery required Prisma reset → Alembic upgrade in that exact order.

**Recovery hit two layered bugs:**
1. `frontend/.env` had `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jobtrackr` — wrong credentials. The compose stack uses `jobtrackr:jobtrackr`. Prisma was failing to authenticate and silently no-op'ing. Root `.env` had the same wrong credentials. Fixed both. `frontend/.env` uses `localhost:5432` (because `npx prisma` runs on the Mac); root `.env` uses `db:5432` (because the backend container is in the Docker network).
2. After fixing credentials, Prisma got `P1010: User was denied access` because **a Homebrew Postgres on port 5432 was hijacking `localhost`**. `lsof -i :5432` showed two processes: `com.docker` listening on `*:5432`, and `postgres` (PID 2686) listening specifically on `localhost`. Because the native one bound to localhost first, anything connecting to `localhost:5432` from the Mac hit the Homebrew Postgres, not Docker. Fix: `brew services stop postgresql@14`. The service was also auto-starting; `launchctl bootout gui/$UID/homebrew.mxcl.postgresql@14` made it stick.

**Alembic dropped Prisma's tracker.**
After Prisma reset, running `alembic revision --autogenerate` for the resume_parses migration also detected `_prisma_migrations` as "removed from models" and dropped it. The `include_object` filter in `env.py` had `users`, `accounts`, `sessions`, `verification_tokens` — but not `_prisma_migrations`. Added it. Permanent fix.

**Schema drift in Phase 3.**
The autogenerate also detected a bunch of column type changes (`TIMESTAMP` → `DateTime(timezone=True)`), column renames (`mime_type` → `content_type`, `file_size` → `size_bytes`), and dropped columns (`contacts.linkedin_url`, `contacts.notes`, `notes.updated_at`). All baked into the resume_parses migration silently. The schema is now self-consistent, but the Phase 3 doc described the old shape. Worth a future-Phase audit.

**The schema fix uncovered a Pydantic mismatch.**
Even after the columns were renamed in `models.py` and the DB, `schemas.py`'s `ResumeOut` still listed `mime_type` and `file_size`. So uploading a resume crashed with `ResponseValidationError: 4 validation errors: missing mime_type, missing file_size`. Fixed by renaming the schema fields. The frontend doesn't display either, so no UI change.

**The browser silently dropped click handlers.**
Both the resume upload form and the new application form showed "Load failed" in red, even though the backend was healthy and CORS was correct. The dev server logs showed no `POST` requests at all — the click handler wasn't firing. Eventually traced to: Grammarly's browser extension injects attributes into `<body>` after SSR but before hydration, breaking React's hydration check. React partially tears down the tree and click handlers don't bind. Fix: add `suppressHydrationWarning` to `<html>` and `<body>` in `layout.tsx`. Standard Next.js recommendation.

**Resume parsing crashed with `Client.__init__() got an unexpected keyword argument 'proxies'`.**
The `anthropic==0.39.0` SDK constructs an `httpx.Client(proxies=...)`, but the version of `httpx` installed in the container had removed that parameter. Fix: upgrade `anthropic` to 0.100.0. Updated `requirements.txt` to `anthropic>=0.40.0`. The bug would have hit our new `claude_client.py` too — same SDK call.

---

## Wired but dormant

- **`ANTHROPIC_MODEL` env var.** It's in `.env` (`claude-sonnet-4-20250514`) but no code reads it. `claude_client.py` hardcodes `claude-sonnet-4-5`. Two options for next phase: read the env var (so model can be swapped without a code change), or delete the unused env var. Slight inconsistency; not breaking anything yet.
- **Cost telemetry numbers are stdout only.** The `claude call model=... cost_usd=...` log line goes to `docker compose logs backend`. Not stored anywhere queryable. Phase 5+ might want a `ai_calls` table that logs every invocation with feature, user_id, tokens, cost — useful for per-user usage limits and per-feature cost attribution. Not blocking anything yet.
- **No retry logic.** If Claude returns a 429 or transient 500, the request fails. Phase 5+ should wrap `call_claude_json` with exponential backoff (3 retries, 1s/2s/4s). The Anthropic SDK has built-in retries but they're not configured here.
- **No streaming.** Gap analysis takes 8–12 seconds; streaming would let the UI show partial output. Phase 6 (resume tailoring) will likely want this since the output is longer. Not needed for gap analysis.

---

## What Phase 4 means in plain terms

You now have one user-facing AI feature working end-to-end. More importantly, you have the **substrate** that every future AI feature attaches to: a Claude wrapper, a service-layer pattern, a router pattern, a test mock pattern, and cost telemetry.

Phase 5 (interview prep) will be: write a new system prompt + user template in `interview_prep.py` calling the same `call_claude_json`. New router with the same shape as `gap_analyses.py`. New `interview_prep` model with similar JSON columns. New frontend card with a different layout. Two lines added to `conftest.py` (the new module name in the patcher). Maybe one new test file with the same shape.

Phase 6 (resume tailoring) will be the same plus streaming and probably a "diff view" UI.

The hard infrastructure work is done. From here, AI features are mostly prompt engineering and UI design.

---

## Commands run during Phase 4

For future reference / re-running on a fresh checkout. The "RECOVERY" section at the top is what you do if Phase 3's DB is broken; if it's healthy, skip to "PHASE 4 PROPER."

```bash
# === RECOVERY (only if Phase 3 DB is broken) ===

# 1. Check DB health
docker compose ps
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# If empty, continue. If 11+ tables, skip to PHASE 4 PROPER.

# 2. Fix credentials in both .env files
#    frontend/.env: DATABASE_URL=postgresql://jobtrackr:jobtrackr@localhost:5432/jobtrackr
#    .env (root):   DATABASE_URL=postgresql://jobtrackr:jobtrackr@db:5432/jobtrackr

# 3. Kill any stray native Postgres
brew services list   # check for postgresql@14, postgresql@16, etc.
brew services stop postgresql@14
launchctl bootout gui/$UID/homebrew.mxcl.postgresql@14 2>/dev/null
lsof -i :5432   # confirm only com.docker is listening

# 4. Restart backend so it picks up new root .env
docker compose up -d --force-recreate backend

# 5. Reset Prisma (recreates Prisma's auth tables + tracker)
cd frontend
npx prisma migrate reset --force
cd ..

# 6. Apply Alembic
docker compose exec backend alembic upgrade head

# 7. If resume_parses migration is missing, generate + apply it
ls backend/alembic/versions/   # should see 2 files: 438140292796_*, 8e485d3c95fd_*
# If only 1 file:
docker compose exec backend alembic revision --autogenerate -m "add resume_parses table"
docker compose exec backend alembic upgrade head

# 8. Patch alembic env.py — add _prisma_migrations to include_object filter
# (edit backend/alembic/env.py: extend the set inside include_object)

# 9. Verify
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 11 tables (12 with _prisma_migrations)


# === PHASE 4 PROPER ===

git checkout -b phase-4-gap-analysis

# 1. Reusable Claude wrapper
# (create backend/app/services/claude_client.py)
docker compose exec backend python -c "from app.services.claude_client import call_claude_json; print('ok')"

# 2. Database model + Pydantic schemas
# (edit backend/app/models.py: add GapAnalysis class; add gap_analysis relationship to Application)
# (edit backend/app/schemas.py: add ExperienceGap and GapAnalysisOut)
# (edit backend/app/schemas.py: fix ResumeOut — rename mime_type → content_type, file_size → size_bytes)
docker compose exec backend python -c "from app.models import GapAnalysis, Application; print('ok')"
docker compose exec backend python -c "from app.schemas import GapAnalysisOut, ExperienceGap; print('ok')"

# 3. Service layer
# (create backend/app/services/gap_analysis.py)
docker compose exec backend python -c "from app.services.gap_analysis import run_gap_analysis; print('ok')"

# 4. Router
# (create backend/app/routers/gap_analyses.py)
docker compose exec backend python -c "from app.routers.gap_analyses import router; print('ok')"

# 5. Wire router into main.py
# (edit backend/app/main.py: add gap_analyses to import + include_router)

# 6. Migration
docker compose exec backend alembic revision --autogenerate -m "add gap_analyses table"
# Verify the migration only creates gap_analyses (no surprise drops/changes)
cat backend/alembic/versions/<new_hash>_add_gap_analyses_table.py
docker compose exec backend alembic upgrade head
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: gap_analyses now in the list (12 tables total)

# 7. Tests
# (create backend/tests/conftest.py with mock_claude fixture)
# (create backend/tests/test_gap_analysis.py)
docker compose exec backend pytest -v
# Expected: 9 passed (or however many you had + 3 new)

# 8. SDK upgrade — required for the parse + gap analysis to actually work
docker compose exec backend pip install --upgrade "anthropic>=0.40.0"
docker compose restart backend
# Then make permanent:
# (edit backend/requirements.txt: anthropic==0.39.0 → anthropic>=0.40.0)

# 9. Frontend
# (edit frontend/src/app/layout.tsx: add suppressHydrationWarning to <html> and <body>)
# (edit frontend/src/app/applications/new/page.tsx: add resume picker dropdown)
# (edit frontend/src/app/applications/[id]/page.tsx: add GapAnalysisCard component + render)

# 10. End-to-end test
docker compose up -d
cd frontend && npm run dev
# In Chrome (Safari + Grammarly = hydration issues):
#   sign up → upload resume → parse it → create application with JD + linked resume → run gap analysis
docker compose logs -f backend  # watch for cost telemetry line

# 11. Commit
git add .
git commit -m "Phase 4: gap analysis (resume parse vs JD) + reusable Claude client"
git push -u origin phase-4-gap-analysis
```

---

## What's next

**Phase 5 — Interview prep.** Same skeleton: new system prompt that takes the parsed resume + the application's job description + (optional) the interview round type, returns expected questions, suggested talking points, and behavioral examples drawn from the resume's bullets. New `interview_prep` model attached to `interview_rounds` (one-to-one per round). New router. New service file. Reuse `call_claude_json`, reuse the `mock_claude` test pattern (just add `interview_prep` to the patch list in `conftest.py`).

**Phase 6 — Resume tailoring.** First feature where streaming becomes useful (output is long). Probably also the first feature that wants pgvector — semantic similarity between job description and resume bullets to pick which bullets to rewrite vs. leave alone. New `tailored_resumes` table per (application, resume) pair.

**Phase 7+ — Application analytics.** Cross-cutting: aggregate gap analysis fit scores by company, by role, over time. Not an AI feature itself, but eats the AI features' output.

The pattern from Phase 4 doesn't change for any of these. Service file with prompt + template + one function. Router with the same try/except shape. Model with JSON columns for fluid arrays. Test file with three smoke tests. Frontend card with a button that POSTs and renders the result.