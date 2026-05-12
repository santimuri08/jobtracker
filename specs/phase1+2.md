# JobAgent — Phase 1 & Phase 2 Engineering Notes

**Project:** JobAgent (~/Desktop/jobtracker/)
**Stack:** Next.js 15 (Auth.js v5, Prisma) + FastAPI (SQLAlchemy + Alembic + Postgres 16 + pgvector + Anthropic/Voyage/Resend)
**Period covered:** May 11, 2026
**Author of changes:** Pair-programmed in chat with Claude
**Final state:** Phase 1 & Phase 2 complete. Phase 3 (job search integration), Phase 4 (chat UX polish), Phase 5 (dashboard exports) deferred.

---

## How to read this doc

- Each phase has its **goal**, **files changed**, **why each change**, **gotchas**, and **what was deferred**.
- The Appendix at the end has all reusable operational commands (JWT generation, curl tests, DB queries, rollback patterns).
- If you're picking this back up in 3 months, read the Executive Summary, then the "What still doesn't work" section, then jump to the Appendix.

---

## Executive summary

Before this session, the backend had several silent failures:
1. Resume uploads worked but were never parsed into structured data — gap analysis and cover letters couldn't run.
2. Voyage embeddings were silently broken on every new application (missing config field).
3. The `similar_applications` router existed on disk but was never wired into `main.py` — every `/similar` request returned 404.
4. The chat agent had only 5 tools (basic application CRUD). It refused gap analysis, cover letters, reminders, etc. with "I can't do that."
5. Backend logs were swallowed at the WARNING threshold, so all `logger.info` and `logger.exception` calls disappeared — every bug was a black box.

After this session:
- Resumes auto-parse on upload.
- Embeddings work on every new application.
- The similar-applications endpoint is live.
- The chat agent has 19 tools and aggressively uses them (no "I can't do that" for things it can).
- Reminders feature exists end-to-end (table, router, agent tools) but does NOT email — purely DB-backed.
- Logging works.
- Cover letters, gap analysis, and reminder creation all work through chat.

---

## Phase 1 — Core backend stability

**Goal:** Make the existing backend reliable enough to build on top of. No new features; only fix what was silently broken.

### Phase 1 — Step 1: Audit PostgreSQL schema

**Did:** Inventoried all 15 tables and confirmed:
- Alembic at HEAD `8c09502dc527` (no orphan migrations)
- pgvector 0.8.2 enabled
- Zero orphan rows
- FK isolation working — cross-user queries correctly return 404, never leak data
- Two ORMs (Prisma + SQLAlchemy) coexist cleanly; Prisma owns auth tables, SQLAlchemy owns everything else

**Files changed:** None. The schema was already healthy. We just needed to know that.

**Tables owned by SQLAlchemy:** `applications`, `interview_rounds`, `contacts`, `notes`, `resumes`, `resume_parses`, `gap_analyses`, `cover_letters`, `email_preferences`, `scheduled_job_runs`. After this session, also `reminders`.

**Tables owned by Prisma:** `users`, `accounts`, `sessions`, `verification_tokens`. SQLAlchemy mirrors `users` as a read-only model.

### Phase 1 — Step 2: Validate user/profile relationships

**Did:** Confirmed FK relationships, no orphans. Cross-user isolation in routers works because every endpoint filters on `user_id = JWT.sub`.

**Files changed:** None.

### Phase 1 — Step 3: Fix chat persistence

**Did:** Nothing — explicitly deferred to its own milestone.

**Reason:** Chat history is currently in browser `localStorage`. Moving it to Postgres requires new tables (`chats`, `chat_messages`), new migrations, new endpoints, new frontend wiring. It's a multi-hour change that deserves its own focused session, not bolt-on work.

**Status:** Deferred. Tracked but not blocking anything.

### Phase 1 — Step 4: Fix application persistence

**Did:** Investigated reported persistence bug. Result: applications persistence was already working. The frontend's "API 400" errors that looked like persistence bugs were actually downstream feature errors (gap analysis / cover letters) on apps missing prerequisites. Real fix is in Step 5 and Step 6.

**Files changed:** None.

### Phase 1 — Step 5: Fix resume parsing pipeline

**File:** `backend/app/routers/resumes.py`

**The bug:** Resume upload happened in one transaction, but parsing was a separate operation that frontend was supposed to call. Frontend never called it. Result: 9 resumes uploaded over development, 0 ever parsed. Without a `ResumeParse` row, gap analysis and cover letters would refuse with "Linked resume has not been parsed yet."

**The fix:**
- Added `_parse_and_store(db, resume)` helper that does the Claude parse + DB upsert in one place.
- Called from inside the upload endpoint after the file write succeeds. Resume is auto-parsed before the upload endpoint returns.
- Defensive logging at 5 checkpoints: upload start, file written, parse start, parse complete, DB upsert complete. (Useless before the Phase 1 logging fix in Step 6 — see next section.)
- Wrapped DB upsert in its own try/except with rollback on failure. If parsing succeeds but DB write fails, we don't leave a half-state.

**Verified:** Fresh resume upload showed all 5 log checkpoints + `ResumeParse` row in DB.

**Side effect:** Old resumes uploaded before this fix are still unparsed. No backfill script yet — but they can be re-uploaded if needed.

### Phase 1 — Step 6: Fix the things that were silently broken

This step had three independent sub-fixes, each its own atomic change.

#### Phase 1 — Step 6a: Logging is now visible

**File:** `backend/app/main.py`

**The bug:** Python's root logger defaults to `WARNING` level with no handlers. Every `logger.info(...)` and `logger.exception(...)` from our routers and services went straight to `/dev/null`. We had no idea what the backend was doing.

**The fix:** Added `_configure_logging()` at module top of `main.py`. Attaches a stdout handler at INFO level to the root logger, with a marker so we don't double-add on uvicorn reload. Also quiets the noisy third-party loggers (`httpx`, `httpcore`, `openai`, `anthropic`) to WARNING.

```python
def _configure_logging() -> None:
    root = logging.getLogger()
    if any(getattr(h, "_jobagent_handler", False) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", ...))
    handler._jobagent_handler = True
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # quiet noisy libs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)

_configure_logging()
```

**Why this matters:** Every fix after this depended on being able to see what the backend was doing. Without it, we'd have been guessing for the rest of the session.

#### Phase 1 — Step 6b: Voyage embeddings config field

**File:** `backend/app/config.py`

**The bug:** `.env` had `VOYAGE_API_KEY=pa-xxx`. The `Settings` class in `config.py` had `anthropic_api_key`, `resend_api_key`, etc. — but **no `voyage_api_key` field**. pydantic-settings ignored the env var since there was no matching field.

Every time an application was created, the embedding code (`app/services/embeddings.py`) tried `settings.voyage_api_key`, got an `AttributeError`, swallowed it as "Embedding generation failed", and the application was saved with `embedding = NULL`. Result: `/similar` always returned empty results.

**The fix:** Added one line:
```python
# Phase 6: Voyage embeddings (powers /applications/{id}/similar)
voyage_api_key: str = ""
```

**Verified:**
- `settings.voyage_api_key` returns a non-empty string.
- New applications log `voyage embed model=voyage-3-large input_type=document chars=N` followed by 201 Created.
- DB shows `has_embedding = yes` on new rows.

**Pre-existing apps:** Apps 3, 4, 5, 6 turned out to have embeddings (they got them on UPDATE — not on CREATE — somewhere in the past). Apps 7, 8, 10, 12, 14 do not. Embeddings on older apps are a lottery. **No backfill script run yet** — deferred.

#### Phase 1 — Step 6c: Structured 400 errors on AI endpoints

**Files:**
- `backend/app/routers/cover_letters.py`
- `backend/app/routers/gap_analyses.py`

**The bug:** When gap-analysis or cover-letter endpoints were called on an app missing prerequisites, they returned `HTTPException(400, detail="Application has no linked resume.")`. The frontend just showed "API 400". The chat agent had no way to know *which* prerequisite was missing — JD? Resume? Parse? — so it couldn't tell the user how to fix it.

**The fix:** Added `_check_application_ready(db, app_obj, feature)` helper to both routers. Returns `(app, parse)` on success. On failure raises:

```json
{
  "detail": {
    "error": "missing_requirements",
    "feature": "gap_analysis",
    "missing": ["job_description", "linked_resume", "parsed_resume"],
    "message": "This application needs a job description, a linked resume, and a parsed resume before you can run gap analysis.",
    "actions": [
      {"label": "Add job description", "kind": "add_job_description", "application_id": 7},
      {"label": "Link a resume", "kind": "link_resume", "application_id": 7}
    ]
  }
}
```

The `missing` array lists **every** unmet requirement (not just the first), so the user fixes them all at once. The `actions` array gives the UI / agent suggested follow-up calls. Helper is duplicated across both routers (not extracted to a service) on purpose — same justification as the existing `_get_app_or_404` duplication. We extract on a 3rd caller, not the 2nd.

**Verified via three curl tests:**
- App 4 (Stripe, has JD, no resume) → 400 with `missing: ["linked_resume", "parsed_resume"]`.
- App 7 (Amazon, nothing) → 400 with all three missing.
- App 4 cover-letter endpoint → same shape but `feature: "cover_letter"`.

---

## Phase 1 — final scorecard

| Step | Status |
|---|---|
| 1. Audit PostgreSQL schema | ✅ Done |
| 2. Validate user/profile relationships | ✅ Done |
| 3. Fix chat persistence | ⏳ Deferred (its own milestone) |
| 4. Fix application persistence | ✅ Verified already working |
| 5. Fix resume parsing pipeline | ✅ Done — auto-parse on upload |
| 6a. Logging visible | ✅ Done — substrate for all future debug |
| 6b. Voyage embeddings | ✅ Done — embeddings on every new app |
| 6c. Structured 400 errors | ✅ Done — both AI endpoints |

**Files changed in Phase 1:**
- `backend/app/routers/resumes.py`
- `backend/app/main.py`
- `backend/app/config.py`
- `backend/app/routers/cover_letters.py`
- `backend/app/routers/gap_analyses.py`

5 files total. No new migrations. No new dependencies.

---

## Phase 2 — AI tool orchestration

**Goal:** Make the chat agent actually able to *do things*, not just talk about doing them.

Before Phase 2, the agent had 5 tools — basic application CRUD only. It refused gap analysis, cover letters, similar-jobs, reminders, etc. with "I can't do that, use the dashboard." This made the chat feel like a thin wrapper.

### Phase 2.1 — Connect chat to existing backend routers

**Files changed:**
- `backend/app/main.py` (wire similar_applications router)
- `backend/app/routers/agent.py` (full rewrite: 5 tools → 16 tools, system prompt rewritten)

#### Phase 2.1a — Wire `similar_applications` router

`backend/app/routers/similar_applications.py` existed on disk (Phase 6 work) but was never imported into `main.py`. Every `/api/v1/applications/{id}/similar?limit=N` request returned 404. We never noticed because the frontend's "Similar" widget gracefully showed nothing.

**The fix:**
```python
# in main.py imports tuple
from app.routers import (
    ...,
    similar_applications,
    ...,
)
# at bottom
app.include_router(similar_applications.router)
```

**Verified:**
- App 15 (cross-user) → 404 "Application not found" ✓
- App 3 (santimuri039, has embedding) → 200 with 3 results (Datadog 0.68, Figma 0.67, Stripe 0.66 similarity) ✓

The similarity scores cluster around 0.66-0.68 for software-engineering roles. Math is real.

#### Phase 2.1b — Agent rewrite

The chat agent (`agent.py`) was rewritten from scratch. Same loop structure, same error handling, but:

- **5 tools → 16 tools.** New tools:
  - `list_resumes` — list user's uploaded resumes
  - `link_resume_to_application` — set `application.resume_id`
  - `check_application_readiness` — non-raising version of the structured 400 check
  - `run_gap_analysis` — call gap_analysis service, upsert row
  - `generate_cover_letter` — call cover_letter service, save as draft
  - `rewrite_bullet` — call bullet_rewriter service
  - `find_similar_applications` — direct call into similar_applications logic
  - `add_interview_round` — accepts loose ISO date phrases (Claude converts)
  - `delete_interview_round`
  - `add_contact`
  - `add_note`
- **System prompt rewritten.** New prompt:
  - Lists every capability explicitly
  - Says "Don't refuse a task your tools cover" repeatedly
  - Notes specific things the agent *cannot* do (send emails, scrape sites, modify Google Calendar) for honesty
  - Tells the agent to read `missing_requirements` responses and offer the right follow-up
  - Tells the agent to convert loose date phrases ("next Tuesday at 2pm") to ISO before calling tools
- **`max_iterations` raised 8 → 10.** Some tool chains are longer now (list_resumes → link_resume → run_gap_analysis = 3 turns).
- **`max_tokens` raised 2048 → 4096.** Cover letters need ~400 words plus the agent's confirmation message.

**Service signatures used (matched exactly to verify):**
- `run_gap_analysis(resume_dict, job_description) -> dict` — positional
- `run_cover_letter(*, resume_parse, job_description, company, role, tone=None, extra_instructions=None) -> dict` — **keyword-only**
- `run_bullet_rewrite(*, bullet, job_description=None) -> dict` — **keyword-only**

**Gotcha:** The `*` in `def run_cover_letter(*, ...)` means it CANNOT be called positionally. Trip me up if you forget — you get an opaque `TypeError`.

**Verified through chat:** Gap analysis and cover letter generation worked end-to-end after a backend restart. User explicitly confirmed: "worked I needed to restart the backend docker, gap analysis, and cover letter worked".

### Phase 2.2 — Reminders feature

**Goal:** Build a real new feature end-to-end, not just wire existing routers. Add a `reminders` table the agent can create, list, and complete.

**Design decisions made before code:**

| Question | Answer | Why |
|---|---|---|
| Schema | `id, user_id, application_id?, message, due_at, completed_at?, notified_at?, notification_channel?, created_at` | `completed_at` determines state; reminder can be standalone or attached |
| Notifications | DB-only for now. `notified_at` and `notification_channel` are nullable in schema for later. | "Too much infrastructure too early" |
| Date parsing | Claude parses natural language → ISO before tool call | Already works for interview rounds; no new lib needed |
| Migration | Hand-written, not autogenerate | Two-ORM setup makes autogen risky |
| Indexes | `user_id`, `due_at`, `completed_at`, `application_id` | Queries we'll actually run |

**Files changed:**

| File | Status | Lines |
|---|---|---|
| `backend/alembic/versions/527f35a1de92_add_reminders_table.py` | NEW | ~50 |
| `backend/app/models.py` | MODIFIED — added `Reminder` class + 2 relationship lines | +25 |
| `backend/app/schemas.py` | MODIFIED — appended 4 reminder schema classes | +23 |
| `backend/app/routers/reminders.py` | NEW | ~155 |
| `backend/app/main.py` | MODIFIED — wired reminders router | +2 |
| `backend/app/routers/agent.py` | MODIFIED — 3 new tools (create_reminder, list_reminders, complete_reminder) | +130 |

**Migration body:**

```python
def upgrade() -> None:
    op.create_table(
        'reminders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('application_id', sa.Integer(), sa.ForeignKey('applications.id', ondelete='CASCADE'), nullable=True),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notification_channel', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_reminders_user_id', 'reminders', ['user_id'])
    op.create_index('ix_reminders_due_at', 'reminders', ['due_at'])
    op.create_index('ix_reminders_completed_at', 'reminders', ['completed_at'])
    op.create_index('ix_reminders_application_id', 'reminders', ['application_id'])

def downgrade() -> None:
    op.drop_index('ix_reminders_application_id', table_name='reminders')
    op.drop_index('ix_reminders_completed_at', table_name='reminders')
    op.drop_index('ix_reminders_due_at', table_name='reminders')
    op.drop_index('ix_reminders_user_id', table_name='reminders')
    op.drop_table('reminders')
```

**Router endpoints (`/api/v1/reminders`):**
- `GET /` — list with `?status=pending|completed|overdue|due_soon`, `?application_id=N`
- `POST /` — create
- `GET /{id}` — detail
- `PATCH /{id}` — update (supports `{"completed": true}` shortcut to set `completed_at = now`)
- `DELETE /{id}` — delete

**Agent tools added:**
- `create_reminder(message, due_at, application_id?)` — Claude converts loose date to ISO
- `list_reminders(status?, application_id?)`
- `complete_reminder(reminder_id)`

**Verified:**
- All 5 router endpoints work (full curl test suite passed including cross-user 404)
- Agent successfully created, listed, and completed reminders via chat

### Phase 2 — final scorecard

Audit doc's Phase 2 items:

| Item | Status |
|---|---|
| 1. Connect chat to backend tools | ✅ |
| 2. Implement AI action routing | ✅ |
| 3a. Cover letters in chat | ✅ |
| 3b. Gap analysis in chat | ✅ |
| 3c. Reminders in chat | ✅ (DB + chat, no email) |
| 3d. Similar jobs in chat | ✅ |
| 3e. Recruiter notes in chat | ✅ |
| 3f. Interview scheduling in chat | ✅ |
| 4. Prevent "I can't do that" | ✅ |

---

## Gotchas, mistakes, and lessons learned

These cost us time. Recording them so they don't again.

### Gotcha 1: JWT secret rotation

**What happened:** Mid-session, the JWT secret got rotated (a leaked token had been pasted into chat). Both `.env` (backend) and `frontend/.env` need to match. We rotated using `openssl rand -base64 48`, updated both files, restarted both services. Browser sessions for both users were invalidated.

**Lesson:** Never paste full JWTs into chat. Always use shell variables. The `$JWT` export pattern via `docker compose exec -T backend python -c "..." | tr -d '\r\n'` is safe — token never hits stdout.

### Gotcha 2: zsh and `?` in URLs

**What happened:** Repeatedly ran `curl http://localhost:8000/api/v1/applications/15/similar?limit=5` and got `zsh: no matches found:` — zsh interprets unquoted `?` as a single-char glob.

**Lesson:** Always quote URLs with query strings: `curl "http://localhost:8000/...?limit=5"`. Same applies to `&`, `*`, `(`, `)`.

### Gotcha 3: Migration revision placeholder

**What happened:** I gave the user a migration body with `revision = 'YOUR_HASH_HERE'` as a placeholder, meant to be replaced with the real hash Alembic generated. The user pasted it literally. Migration ran successfully but recorded `'YOUR_HASH_HERE'` as the revision string. Filename was `527f35a1de92_add_reminders_table.py` but inside, `revision = 'YOUR_HASH_HERE'`. They didn't match.

**Fix:** Edited the file's `revision = '...'` line to match the filename, then `UPDATE alembic_version SET version_num = '527f35a1de92'` in Postgres.

**Lesson when writing migrations:** Either generate the file with `alembic revision -m "..."` *first*, see the actual hash, then provide a body to paste — or use a `sed` command that auto-replaces the line. Never use a placeholder string the user has to manually substitute.

**Cosmetic leftover:** The migration file's docstring still says `Revision ID: YOUR_HASH_HERE`. Alembic doesn't read docstrings, so this is harmless but ugly. Fix optional.

### Gotcha 4: Backend hot-reload doesn't always pick up changes

**What happened:** After the agent.py rewrite, the user tested in chat and the agent still said "I don't have a gap analysis tool." Source on disk was correct. The container's view of the file was stale (uvicorn's auto-reload hadn't picked it up).

**Fix:** `docker compose restart backend`.

**Lesson:** When in doubt, hard-restart. Hot-reload is best-effort. After every structural change (new imports, new top-level definitions), restart. Verify with `docker compose exec backend grep -c "<new_symbol>" /app/app/<file>` to confirm the bind-mount has the new code.

### Gotcha 5: Agent.py datetime import for reminders

**What happened:** `_tool_complete_reminder` uses `datetime.now(timezone.utc)`. Original `agent.py` had `from datetime import datetime, date` — no `timezone`. Would have crashed at first call.

**Fix:** Added `timezone` and `timedelta` to the import: `from datetime import datetime, date, timedelta, timezone`.

**Lesson:** When adding new functionality to an existing file, grep the imports first.

### Gotcha 6: Migrations and two ORMs

We never used `alembic revision --autogenerate` because Prisma owns 4 tables (`users`, `accounts`, `sessions`, `verification_tokens`) and SQLAlchemy doesn't know they exist as managed tables. Autogenerate would have tried to drop them.

**Lesson:** Hand-write every migration body. Costs ~5 extra minutes of typing per migration. Saves hours of "why did my users table get dropped."

---

## What's still NOT done

State of the system honestly:

### Functionality gaps

- **Chat persistence is localStorage-only.** Refresh the browser, history is gone. Cross-device sync doesn't work. Audit doc Phase 1 Step 3, deferred.
- **No frontend UI for reminders.** Reminders exist in DB and through chat. There's no "Reminders" page on the dashboard. Users can't see overdue items without asking the chat.
- **No email notifications for reminders.** When `due_at` passes, nothing happens. Schema is ready (`notified_at`, `notification_channel` columns exist) — just no cron job. Roughly 150 lines of work + careful retry/dedup logic when we want to add it.
- **No backfill of embeddings on old applications.** Apps 7, 8, 10, 12, 14 have `embedding IS NULL`. They won't appear in `/similar` results. 20-line script is the fix when we want it.

### UX gaps

- **Tool result cards in chat are minimal.** When the agent runs gap analysis, the result comes back as plain text — not a styled card with fit score / matched skills / missing skills laid out visually. `Chat.tsx` has `TOOL_LABELS` mapping for tool pills but no per-tool result-card renderer.
- **The cover-letter draft created via chat may not appear automatically on the dashboard's cover-letter card.** Frontend doesn't poll. User has to refresh the application detail page. Untested in this session.

### Operational gaps

- **No automated tests.** Every verification was manual (curl + browser chat). When we touch agent.py again, we'll be relying on smoke tests to catch regressions.
- **No CI.** Same reason.

---

## Phase 3+ — what's next (audit doc's plan)

Documented for context; not done yet.

- **Phase 3 — Job search integration.** Indeed API / LinkedIn jobs feed. Out of scope for everything we did.
- **Phase 4 — Chat UX polish.** Mobile audit, tool result cards, remove any remaining duplicated navigation.
- **Phase 5 — Dashboard exports.** `.ics` calendar export for interviews, Google Calendar sync, CSV export of applications.

---

## Appendix — operational reference

Everything we used repeatedly. Keep this section handy.

### Generating a JWT without browser

The backend's `get_current_user` accepts any JWT signed with `JWT_SECRET`. You can mint one for any user inside the backend container — no browser needed, no copy-paste from DevTools.

**Caveat: Never paste the resulting JWT into chat with another developer or AI.** Use shell variables only.

```bash
export JWT=$(docker compose exec -T backend python -c "
import time
from jose import jwt
from app.config import settings
print(jwt.encode(
    {'sub': 'cmoxsr1i90000t41fp9i48dmt', 'email': '[email protected]', 'iat': int(time.time()), 'exp': int(time.time()) + 3600},
    settings.jwt_secret,
    algorithm=settings.jwt_algorithm,
))" | tr -d '\r\n')

# Verify without revealing
echo "JWT length: ${#JWT}"     # should be ~200-220
echo "JWT prefix: ${JWT:0:20}..."
```

**User IDs:**
- `santimuri039@gmail.com` → `cmoxsr1i90000t41fp9i48dmt`
- `santimuri636@gmail.com` → `cmp1ifhu50000x71fhrh0q02v`

### Quick auth test

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $JWT" \
  http://localhost:8000/api/v1/me
```

Should print `HTTP 200`.

### Common curl tests

```bash
# List applications
curl -s -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/applications" | jq

# Trigger gap analysis (returns 400 with structured detail if not ready)
curl -i -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/applications/4/gap-analysis"

# Generate cover letter (15s)
curl -i -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"tone":"professional","extra_instructions":""}' \
  "http://localhost:8000/api/v1/applications/4/cover-letters"

# Get similar applications (requires source app to have embedding)
curl -i -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/applications/3/similar?limit=5"

# List reminders
curl -s -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/reminders" | jq

# Create reminder
curl -i -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"Follow up with X","due_at":"2026-05-20T14:00:00Z"}' \
  "http://localhost:8000/api/v1/reminders"
```

Remember to quote URLs with `?` — zsh.

### Common DB queries

```bash
# Quick row counts
docker compose exec db psql -U jobtrackr -d jobtrackr -c "
SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM applications) AS apps,
    (SELECT COUNT(*) FROM resumes) AS resumes,
    (SELECT COUNT(*) FROM resume_parses) AS parses,
    (SELECT COUNT(*) FROM gap_analyses) AS gaps,
    (SELECT COUNT(*) FROM cover_letters) AS covers,
    (SELECT COUNT(*) FROM reminders) AS reminders;
"

# Apps with their embedding state
docker compose exec db psql -U jobtrackr -d jobtrackr -c "
SELECT id, company, role,
       CASE WHEN embedding IS NULL THEN 'NO' ELSE 'yes' END AS has_embedding,
       resume_id IS NOT NULL AS has_resume,
       length(job_description) > 0 AS has_jd
FROM applications ORDER BY id;
"

# Reminders with state
docker compose exec db psql -U jobtrackr -d jobtrackr -c "
SELECT id, application_id, message, due_at, completed_at,
       CASE
         WHEN completed_at IS NOT NULL THEN 'done'
         WHEN due_at < now() THEN 'overdue'
         WHEN due_at < now() + interval '7 days' THEN 'due_soon'
         ELSE 'pending'
       END AS state
FROM reminders ORDER BY due_at;
"

# Check schema of a table
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\d reminders"

# Alembic state
docker compose exec backend alembic current
docker compose exec backend alembic history --verbose | head -30
```

### Generating a new migration safely

```bash
# 1. Generate empty migration file (Alembic picks the hash + chains to current HEAD)
docker compose exec backend alembic revision -m "your description"
# Note the printed path. Look at backend/alembic/versions/<hash>_your_description.py.

# 2. Edit the file's upgrade() and downgrade() bodies.
#    DO NOT touch the `revision = '...'` or `down_revision = '...'` lines.

# 3. Apply
docker compose exec backend alembic upgrade head

# Rollback if needed
docker compose exec backend alembic downgrade -1
```

### Log filtering

Filter out noisy polling endpoints when watching logs:

```bash
docker compose logs -f --tail=0 backend 2>&1 | grep -Ev "OPTIONS|GET /api/v1/(applications\?|applications/summary|email-preferences)"
```

Watch a specific subsystem:

```bash
docker compose logs -f backend 2>&1 | grep -iE "(agent turn|tool .* failed|voyage|embed|reminder)"
```

### File backup + restart pattern

For every code change:

```bash
cp backend/app/path/to/file.py backend/app/path/to/file.py.bak
# edit the file
docker compose restart backend
sleep 3
docker compose logs backend --tail=15
```

If startup is clean, delete the .bak when comfortable. If it crashes:

```bash
mv backend/app/path/to/file.py.bak backend/app/path/to/file.py
docker compose restart backend
```

### Container-side grep to confirm a change landed

The bind-mount usually picks up file edits immediately, but sometimes it lags. Verify what the container actually sees:

```bash
docker compose exec backend grep -c "your_new_symbol" /app/app/path/to/file.py
```

Should match what's on your local disk. If `0`, the bind-mount didn't pick it up — restart.

---

## Final state — what works today

The system as of end of this session:

1. **Resume upload** → auto-parsed → ready for AI features in one step
2. **Application create** → auto-embedded → eligible for `/similar` immediately
3. **Gap analysis** → works via dashboard endpoint AND via chat
4. **Cover letter generation** → works via dashboard endpoint AND via chat
5. **Bullet rewrite** → works via dashboard endpoint AND via chat
6. **Similar applications** → endpoint works; chat tool works; only constrained by which apps have embeddings
7. **Interview rounds** → CRUD via dashboard AND via chat (loose date phrases auto-converted)
8. **Contacts & notes** → CRUD via dashboard AND via chat
9. **Reminders** → CRUD via REST AND via chat. No email yet.
10. **Logging** → visible. Every `logger.info` and `logger.exception` lands in `docker compose logs`.

The chat agent has 19 tools. The "I can't do that" reflex is gone for everything covered by tools.

---

*End of Phase 1 & 2 notes. Pick this up by reading the Executive Summary, then the "What still doesn't work" section, then jumping to the Appendix for ops commands.*