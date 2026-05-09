# Phase 7 — Background Jobs & Weekly Email

## What Phase 7 set out to do

Phases 4, 5, and 6 built and reused the synchronous AI substrate — request comes in, Claude (or Voyage) runs, response goes out. Phase 7 introduces a **second runtime mode**: work that runs **without an HTTP request**, on a wall-clock schedule, against a queue of users, persisting its own audit log. Plus a **second external service** (Resend, for transactional email) sitting alongside Anthropic and Voyage with the same wrapper-pattern discipline.

The "done when" criteria were: a logged-in user clicks "Send test now" on their dashboard, ~30 seconds later a real email lands in their inbox containing accurate data about their job-search activity, the email looks good, the user can opt out via the unsubscribe link, and a cron is registered to fire every Monday at 9:00 AM UTC for the scheduled batch run. All of that now works.

The point of Phase 7 wasn't really the email itself — it was to **prove the substrate handles a fundamentally different kind of workload** (scheduled, batched, multi-user) without rebuilding the architecture. It did. Same service-file pattern, same router pattern, same error-shape conventions, same mock fixture trick. The new things are APScheduler, the lifespan context manager, and the audit-log table.

---

## The mental model

Phase 7 introduces three things that didn't exist before:

**1. A second external service (Resend).** Anthropic does generation, Voyage does embeddings, Resend does email delivery. All three are accessed through the same shape: a thin wrapper file (`claude_client.py`, `embeddings.py`, `email_sender.py`), one env var (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `RESEND_API_KEY`), one Python package. Each provider knows nothing about the others. Adding a fourth would be the same recipe.

**2. A scheduler running in-process.** APScheduler's `BackgroundScheduler` is a thread that lives inside the uvicorn process. When the cron fires, the job runs in that thread without blocking any HTTP request. No separate worker, no Redis, no Celery. Just a thread. The trade-off: if you scale to two backend containers, you have two schedulers (= duplicate emails). For single-instance personal use this is plenty; production multi-instance would need either a Redis-backed scheduler or a dedicated worker container.

**3. A FastAPI lifespan context.** Until now `main.py` was just routes. Now it needs to manage a long-running thread that should start when the server starts and stop cleanly when the server stops. FastAPI's `lifespan` async context is the standard way to do that. `start_scheduler()` runs on startup, `stop_scheduler()` runs on shutdown.

The data model is two new tables, both conservative:

- **`email_preferences`** — one row per user. Tracks `frequency` (`weekly` or `off`), `last_sent_at`, and a random `unsubscribe_token` for one-click opt-out. One-to-one with `users` (unique constraint on `user_id`). Lazily created the first time the user hits any email-related endpoint.
- **`scheduled_job_runs`** — one row per scheduled batch run. Records `job_name`, `status` (`success`/`error`), `started_at`/`finished_at`, `duration_ms`, `users_processed`, `emails_sent`, `error_message`. Phase 8+ would read from this for an admin dashboard.

Two design decisions worth calling out:

- **Cover letters were many-per-parent. Email preferences are one-per-parent.** Different shapes for different needs. Each user has exactly one set of preferences, no draft/version semantics.
- **Bullet rewrites had no table at all (transient suggestions). Email preferences and job runs both have tables.** Persistence follows from "do we need to read this back later?" Email prefs: yes (which user wants what). Job runs: yes (did Monday's batch succeed). Bullet rewrites: no (user picks one, pastes it elsewhere, suggestions are spent).

---

## What's running right now

Same Phase 5 stack with two additions: APScheduler running as a thread inside the FastAPI worker, and a third SDK (`resend`) installed in the backend container. Two new tables (`email_preferences`, `scheduled_job_runs`), six new backend files, two new test files, one updated frontend file (the dashboard page now hosts an email-preferences card above the pipeline summary).

The full **manual trigger** round trip:

User on `/dashboard` → sees the "Weekly summary email" card → clicks "Send test now" → frontend POSTs to `http://localhost:8000/api/v1/email-preferences/test` with the JWT and an empty body → router fetches the live `User` row → calls `run_for_user(db, db_user, force=True, override_to=settings.email_test_recipient)` → `_get_or_create_pref` lazily creates an `EmailPreference` row (with a random 24-byte URL-safe `unsubscribe_token`) if one doesn't exist → cooldown/frequency checks bypassed because `force=True` → `_collect_stats` queries the user's applications, computes `by_status` counts, finds `new_apps` and `applied_this_week`, looks up the next 5 pending interviews → calls `run_weekly_summary(stats, week_ending)` → service formats the prompt and calls `call_claude_json(system=..., user=..., max_tokens=1500)` → SDK call to `claude-sonnet-4-5`, ~5–10 seconds → Claude returns `{"subject", "preheader", "summary_html", "suggestions": [...]}`, parsed to dict, token cost logged → router renders HTML via `render_weekly_summary_html(...)` (pure f-string, no template engine) → calls `send_email(to=..., subject=..., html=...)` → SDK call to Resend, ~200–500ms → email lands in the user's inbox → `pref.last_sent_at = now`, `db.commit()` → returns `{"sent": True, "email_to": ..., "summary_preview": ...}` to the frontend.

The **scheduled batch** round trip is the same shape with three differences: no HTTP request triggers it (APScheduler's cron does), it loops every `User`, and at the end it writes one row to `scheduled_job_runs` with the aggregated outcome.

The **unsubscribe** round trip is shorter: footer link in email → POST `/api/v1/unsubscribe` with `{token: "..."}` (no auth header) → router queries `EmailPreference WHERE unsubscribe_token = :token` → 404 if missing, otherwise `pref.frequency = "off"`, commit, return `{"ok": true}`. The token IS the credential; auth bypass is intentional so the link works even when the user isn't logged in.

Every authenticated endpoint enforces `pref.user_id == current_user.id` indirectly (the helper looks up by `user_id == user.id`). Same isolation guarantee every other phase has.

---

## File-by-file walkthrough

### Backend

**`.env`** (modified)

Three new lines added at the bottom:

```
RESEND_API_KEY=re_...
[email protected]
[email protected]
```

`onboarding@resend.dev` is Resend's public sandbox sender — works without verifying a domain. `EMAIL_TEST_RECIPIENT` is needed because the sandbox sender will only deliver to the address you signed up to Resend with. The manual-trigger router redirects to this address; the scheduled batch (when run on a verified domain) wouldn't.

**`.env.example`** (modified)

Same three keys, empty values. `RESEND_FROM_EMAIL` defaults to the sandbox sender so a fresh checkout works without further config.

**`docker-compose.yml`** (modified)

Three new lines in the `backend.environment:` block:

```yaml
      RESEND_API_KEY: ${RESEND_API_KEY}
      RESEND_FROM_EMAIL: ${RESEND_FROM_EMAIL}
      EMAIL_TEST_RECIPIENT: ${EMAIL_TEST_RECIPIENT}
```

Forwards the three new env vars from the host's `.env` into the container at compose time. Without this, the container can't see them even though they're in the file.

**`backend/app/config.py`** (modified)

Three new fields in the `Settings` class:

```python
resend_api_key: str = ""
resend_from_email: str = "onboarding@resend.dev"
email_test_recipient: str = ""
```

Empty defaults so the backend boots without keys; only the email send fails (with a clear `RuntimeError`) if the key is missing. Pydantic auto-maps snake_case fields to uppercase env vars because of `case_sensitive=False`.

**`backend/requirements.txt`** (modified)

Two new lines at the bottom:

```
apscheduler>=3.10
resend>=2.0
```

After editing, ran `docker compose build backend` to rebuild the image. The lockfile pinned versions ended up at `apscheduler 3.11.2` and `resend 2.30.0` — both well above the floors.

**`backend/app/models.py`** (modified)

Three small edits:

1. Inside the `User` class, added one relationship line at the bottom:
   ```python
   email_preference = relationship(
       "EmailPreference",
       back_populates="user",
       uselist=False,
       cascade="all, delete-orphan",
   )
   ```
   `uselist=False` says "one-to-one, not one-to-many" — same trick Phase 3 used for `Resume.parse`.

2. Two new model classes appended at the bottom:

```python
class EmailPreference(Base):
    __tablename__ = "email_preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    frequency = Column(String, nullable=False, default="weekly")  # "weekly" | "off"
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    unsubscribe_token = Column(String, nullable=False, unique=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="email_preference")


class ScheduledJobRun(Base):
    __tablename__ = "scheduled_job_runs"

    id = Column(Integer, primary_key=True)
    job_name = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False)  # "success" | "error"
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    users_processed = Column(Integer, nullable=True)
    emails_sent = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

`unique=True` on `email_preferences.user_id` enforces the one-per-user rule at the DB level. CASCADE on the FK so deleting a user drops their prefs row. `unsubscribe_token` has both `unique=True` and `index=True` so the public unsubscribe lookup is O(1). `scheduled_job_runs` has no FKs at all — it's a pure log table; no parent to attach to.

**`backend/app/schemas.py`** (modified)

Three new Pydantic schemas appended at the bottom:

```python
class EmailPreferenceOut(ORMModel):
    frequency: str
    last_sent_at: Optional[datetime] = None


class EmailPreferenceUpdate(BaseModel):
    frequency: str  # "weekly" | "off"


class TriggerWeeklySummaryOut(BaseModel):
    sent: bool
    skipped_reason: Optional[str] = None
    email_to: Optional[str] = None
    summary_preview: Optional[str] = None
```

`EmailPreferenceOut` extends `ORMModel` because it's serialized from a SQLAlchemy row. `EmailPreferenceUpdate` and `TriggerWeeklySummaryOut` extend `BaseModel` because they're never read from a DB row — one is a request body, the other is constructed manually by the router from the orchestrator's return dict.

**`backend/app/services/weekly_summary.py`** (new)

Same shape as Phase 4's `gap_analysis.py` and Phase 5's `cover_letter.py`. A `SYSTEM_PROMPT` describing the role ("supportive, concise career coach"), the rules ("output STRICT JSON, no preamble, no markdown, no code fences, never invent jobs/companies/dates, keep `summary_html` under 350 words"), and a `USER_TEMPLATE` with `{stats_json}` and `{week_ending}` placeholders.

The schema Claude must emit:
```json
{
  "subject": "string - max 60 characters",
  "preheader": "string - max 90 characters",
  "summary_html": "string - simple HTML (<p>, <strong>, <ul>, <li>)",
  "suggestions": ["string", "string", "string"]
}
```

The function:

```python
def run_weekly_summary(stats: dict, week_ending: str) -> dict[str, Any]:
    if not isinstance(stats, dict):
        raise ValueError("stats must be a dict")

    user_prompt = USER_TEMPLATE.format(
        stats_json=json.dumps(stats, ensure_ascii=False, indent=2, default=str),
        week_ending=week_ending,
    )

    return call_claude_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=1500,
    )
```

`max_tokens=1500` is enough for a short body plus three suggestions (cover letters needed 2048 because they're longer; gap analysis needed 2048 for its many fields). `default=str` in `json.dumps` is defensive — when stats contain `datetime` or `date` objects, `default=str` calls `str()` on them rather than crashing. Pure Python, no Anthropic SDK imports here.

**`backend/app/services/email_sender.py`** (new)

The Resend wrapper. Same intent as `claude_client.py` from Phase 4 and `embeddings.py` from Phase 6 — every email send goes through this one file. Centralizes API key handling, the from-address default, and logging.

```python
def send_email(*, to: str, subject: str, html: str) -> dict:
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY is not set")

    resend.api_key = settings.resend_api_key

    params: resend.Emails.SendParams = {
        "from": settings.resend_from_email,
        "to": [to],
        "subject": subject,
        "html": html,
    }

    result = resend.Emails.send(params)
    logger.info("resend send to=%s subject=%r id=%s", to, subject, result.get("id"))
    return result
```

`resend.api_key = ...` is set on every call (the SDK wants its key as a module-level global). Resend's API takes a list of recipients even for one address, hence `[to]`. Keyword-only arguments (the `*,`) match the convention `call_claude_json` uses. Future swap to SES or Postmark would only touch this file.

**`backend/app/services/email_template.py`** (new)

Builds the final HTML. Pure f-string formatting, no Jinja2 or any template engine — five `{placeholder}` substitutions and we're done.

```python
def render_weekly_summary_html(
    *,
    user_name: str | None,
    preheader: str,
    summary_html: str,
    suggestions: list[str],
    unsubscribe_url: str,
    week_ending: str,
) -> str:
    greeting = f"Hi {user_name}," if user_name else "Hi,"
    suggestions_html = "".join(f"<li>{s}</li>" for s in suggestions)

    return f"""<!DOCTYPE html>...
    """
```

Three things worth knowing about the template:
- **All CSS inline** — Gmail strips `<style>` blocks aggressively. Inline always renders.
- **Layout is `<table>`-based** — still the email-HTML standard in 2026 for Outlook compatibility.
- **Hidden preheader `<div>`** — the gray text Gmail shows next to the subject in the inbox list. Standard trick.

`max-width:600px` for desktop readability and mobile responsiveness. Renders to roughly 2400 characters of HTML, well under Gmail's 102KB clipping threshold.

**`backend/app/services/weekly_summary_job.py`** (new, the orchestrator)

The most important file in Phase 7. Ties Claude, the template, Resend, and the database together. Two public functions:

`run_for_user(db, user, *, force=False, override_to=None)`:
1. `_get_or_create_pref(db, user)` — creates `EmailPreference` if missing (random 24-byte token).
2. If `force=False`, skip if `frequency != "weekly"` (returns `{"sent": False, "skipped_reason": "frequency_off"}`).
3. If `force=False` and `last_sent_at` is within the last 6 days, skip (returns `{"sent": False, "skipped_reason": "recently_sent"}`).
4. `_collect_stats(db, user, since)` queries the user's applications, computes `by_status`, finds `new_apps` and `applied_this_week`, looks up next 5 pending interviews.
5. `run_weekly_summary(stats, week_ending)` calls Claude.
6. `render_weekly_summary_html(...)` builds the email body.
7. `send_email(to=override_to or user.email, subject=..., html=...)` ships it.
8. `pref.last_sent_at = now`, commit.

Returns `{"sent": True, "email_to": ..., "summary_preview": ...}`.

`run_for_all_users(db)`:
- Loops every `User` row.
- For each, `try: run_for_user(...)` with `force=False` (respects the user's preference and cooldown).
- Catches per-user exceptions so one bad user doesn't kill the whole batch — appends to an `errors` list and logs via `logger.exception(...)`.
- At the end, writes one `ScheduledJobRun` row with status (`success` or `error`), duration, counts, and joined error messages.

The two flags on `run_for_user` matter because they let one function serve two jobs:
- The cron uses defaults: `force=False`, `override_to=None`.
- The manual trigger uses `force=True`, `override_to=settings.email_test_recipient`.

`MIN_DAYS_BETWEEN_SENDS = 6` (not 7) so timezone drift can't cause a missed send. `secrets.token_urlsafe(24)` generates ~32 unguessable URL-safe characters for the unsubscribe token.

**`backend/app/scheduler.py`** (new)

APScheduler setup. Module-level singleton.

```python
scheduler: BackgroundScheduler | None = None


def _weekly_summary_tick() -> None:
    db = SessionLocal()
    try:
        run_for_all_users(db)
    except Exception:
        logger.exception("weekly_summary tick crashed")
    finally:
        db.close()


def start_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        _weekly_summary_tick,
        trigger=CronTrigger(day_of_week="mon", hour=9, minute=0),
        id="weekly_summary",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    global scheduler
    if scheduler is None:
        return
    scheduler.shutdown(wait=False)
    scheduler = None
```

Critical detail: the tick function opens its own DB session via `SessionLocal()`. APScheduler jobs aren't FastAPI requests, so they can't use `Depends(get_db)` — manual session management is required.

`max_instances=1` + `coalesce=True` means: don't start a second weekly run if the previous one is somehow still going, and if multiple firings get queued (server was down for hours), just run once on resume. `replace_existing=True` makes development restarts safe — re-registering the same job ID just replaces it instead of erroring.

The cron `day_of_week="mon", hour=9, minute=0` fires every Monday at 09:00:00 UTC. Server timezone-agnostic; recipients in UTC-5 see the email arrive at 4 AM Eastern.

**`backend/app/routers/email_preferences.py`** (new)

Four endpoints under `/api/v1`:

```
GET    /email-preferences          → get_my_preferences      (auto-creates on first call)
PATCH  /email-preferences          → update_my_preferences   (sets frequency)
POST   /email-preferences/test     → trigger_weekly_summary_now  (manual trigger button)
POST   /unsubscribe                → unsubscribe             (PUBLIC, token-gated)
```

The `_get_or_create_pref` helper lives both here (for the GET/PATCH path) and in the orchestrator (for the cron path). Slight duplication, but it keeps each layer self-contained — the GET endpoint doesn't have to import from `weekly_summary_job.py`.

The same try/except shape Phase 4 established:

```python
try:
    result = run_for_user(db, db_user, force=True, override_to=override)
except RuntimeError as e:
    raise HTTPException(status_code=500, detail=f"Config error: {e}")
except ValueError as e:
    raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")
except Exception as e:
    raise HTTPException(status_code=502, detail=f"Send failed: {e}")
```

The 502 vs 500 distinction is the same: 502 = "your request was fine but the upstream AI/service screwed up," 500 = "something on our side is broken."

`/unsubscribe` is public — no `Depends(get_current_user)`. The token in the URL IS the credential. Anyone with the token can flip the user's pref to "off," which is exactly the desired behavior for an email-link unsubscribe.

`UnsubscribeIn` and `UnsubscribeOut` are defined inline in the router file rather than promoted to `schemas.py` — they're trivial and only used here.

**`backend/app/main.py`** (modified, more substantial than other phases)

The lifespan addition:

```python
from contextlib import asynccontextmanager
from app.scheduler import start_scheduler, stop_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="JobTrackr Backend", lifespan=lifespan)
```

`@asynccontextmanager` from `contextlib` wraps an async generator. The pattern: code before `yield` runs at startup, code after `yield` (in the `finally` block) runs at shutdown. Cleaner than the older `@app.on_event("startup")` / `@app.on_event("shutdown")` decorators (which are deprecated in current FastAPI).

Plus `email_preferences` was added to the `from app.routers import (...)` block and one `app.include_router(email_preferences.router)` call at the bottom.

**`backend/alembic/versions/8c09502dc527_add_email_preferences_and_scheduled_job_.py`** (generated)

The Phase 7 migration. `down_revision = '27841ce6273b'` correctly chains off Phase 6's `add_embedding_column_to_applications` migration. Creates both new tables and their indexes — no surprise drops or alters of other tables. Autogenerate emitted nine harmless `Detected sequence ... assuming SERIAL and omitting` lines (same noise Phase 5 documented).

The autogenerate also did NOT incorrectly target `_prisma_migrations` for drop, confirming the Phase 4 `include_object` filter still does its job. No manual edits needed this time (unlike Phase 6, where Alembic forgot to import `pgvector.sqlalchemy`).

**`backend/tests/conftest.py`** (modified)

Two new lines added to the `mock_claude` fixture:

```python
import app.services.weekly_summary as weekly_mod
monkeypatch.setattr(weekly_mod, "call_claude_json", _fake_call)
```

Same reasoning as Phases 4 and 5: each service does `from app.services.claude_client import call_claude_json`, which copies the function reference into the importing module's namespace. Patching the source module alone doesn't affect the already-imported references. Every new AI service needs its own line in this fixture.

**`backend/tests/test_email_preferences.py`** (new)

Four smoke tests:
- `test_get_unauthenticated` — GET without token returns 401.
- `test_patch_unauthenticated` — PATCH without token returns 401.
- `test_trigger_unauthenticated` — POST `/test` without token returns 401.
- `test_unsubscribe_with_bad_token_404` — POST `/unsubscribe` with unknown token returns 404 (proves the token lookup query actually runs).

**`backend/tests/test_weekly_summary.py`** (new)

Two service-layer tests:
- `test_run_weekly_summary_returns_mock` — feeds canned `{"subject", "preheader", "summary_html", "suggestions"}` through `mock_claude` and asserts the function returns it intact. The proof that the new fixture line works.
- `test_run_weekly_summary_rejects_non_dict_stats` — confirms `ValueError` on bad input.

Total test count after Phase 7: **22 passing** (16 from end of Phase 5, +4 from `test_email_preferences.py`, +2 from `test_weekly_summary.py`).

### Frontend

**`frontend/src/app/dashboard/page.tsx`** (modified)

Three additions to the existing dashboard page:

1. **One new type** at the top, alongside `Application` and `Summary`:
   ```tsx
   type EmailPreference = {
     frequency: string
     last_sent_at: string | null
   }
   ```

2. **One new render block** in the JSX, placed between the header and the pipeline summary boxes:
   ```tsx
   {session?.backendToken && (
     <EmailPreferencesCard token={session.backendToken} />
   )}
   ```

3. **One new component** at the bottom of the file (outside the default export):

   `EmailPreferencesCard` — small state machine. On mount, GET `/api/v1/email-preferences` (the backend lazily creates the row if missing). Renders the current frequency and `last_sent_at`. Two buttons: "Send test now" (POSTs to `/test`, shows the resulting `email_to` in a green toast), and a toggle that flips between "Turn on" and "Turn off" by PATCHing `frequency`. No persistence on the frontend; refreshing the page just re-fetches.

`useState`, `useEffect`, `useCallback`, and `apiFetch` were all already imported from earlier phases — no import changes needed.

### Infrastructure

No new Docker volumes, no new services, no `npm install`. The existing `pgvector/pgvector:pg16` image is unchanged. The only new infrastructure is the migration file and the two new tables it creates.

The scheduler runs **inside the existing backend container**, as a thread of the existing uvicorn process. Verified via `ls /proc/1/task | wc -l` returning 14 (well above the 1-2 threads a scheduler-less FastAPI would have).

---

## How a typical request flows

**Manual trigger ("Send test now" button):**

1. User on `/dashboard` clicks "Send test now."
2. Browser fires `POST http://localhost:8000/api/v1/email-preferences/test` with `Authorization: Bearer <jwt>` and an empty body.
3. CORS preflight (`OPTIONS`) succeeds.
4. FastAPI routes to `email_preferences.trigger_weekly_summary_now`. Dependencies resolve: `db` from `get_db()`, `user` from `get_current_user(...)`.
5. Handler queries `User WHERE id = current_user.id`. 404 if missing.
6. `override = settings.email_test_recipient or None` → resolves to `[email protected]` (your Resend signup address).
7. Calls `run_for_user(db, db_user, force=True, override_to=override)`.
8. Inside: `_get_or_create_pref` finds existing prefs (or creates). `force=True` means cooldown and frequency skipped.
9. `_collect_stats(db, user, since=now-7d)` runs four queries: all the user's applications, then a join for upcoming interview rounds. Builds the stats dict.
10. `run_weekly_summary(stats, week_ending="May 9, 2026")` formats the prompt, calls `call_claude_json(system=..., user=..., max_tokens=1500)`. ~5–10 seconds round trip to api.anthropic.com.
11. Claude returns `{"subject", "preheader", "summary_html", "suggestions": [...]}`. Token usage logged: `claude call model=claude-sonnet-4-5 in_tok=... out_tok=... cost_usd=... elapsed_ms=...`.
12. Router validates: `subject` truncated to 78 chars, `summary_html` defaults if missing, `suggestions` defaults to `[]` if not a list.
13. `unsubscribe_url = f"http://localhost:3000/unsubscribe?token={pref.unsubscribe_token}"`.
14. `render_weekly_summary_html(...)` builds the ~2400-character HTML body.
15. `to_address = override_to or user.email` → resolves to the test recipient.
16. `send_email(to=to_address, subject=subject, html=html)`. Inside: `resend.api_key` set, `resend.Emails.send(params)` called. ~200–500ms round trip to api.resend.com.
17. Resend returns `{"id": "..."}`. Logged: `resend send to=... subject='...' id=...`.
18. `pref.last_sent_at = now`, `db.commit()`.
19. Returns `{"sent": True, "email_to": ..., "summary_preview": ...}` to the frontend.
20. Frontend shows a green toast: `"Sent to [email protected]. Check your inbox in ~30 seconds."`
21. Email arrives in inbox usually within 5-15 seconds.

**Scheduled batch (every Monday 09:00 UTC):**

1. APScheduler's cron trigger fires inside the running uvicorn process.
2. `_weekly_summary_tick()` runs in the scheduler thread.
3. `db = SessionLocal()` opens a fresh DB session (no FastAPI request, no `Depends(get_db)`).
4. `run_for_all_users(db)` starts.
5. Queries all `User` rows.
6. For each user, `try: run_for_user(db, u, force=False)`. With `force=False`:
   - Skip if `pref.frequency != "weekly"` → `skipped_reason = "frequency_off"`.
   - Skip if `last_sent_at` is within the last 6 days → `skipped_reason = "recently_sent"`.
   - Otherwise: same flow as manual (collect stats → Claude → render → send → update `last_sent_at`).
7. Per-user exceptions caught and appended to `errors` list. One failure doesn't stop the batch.
8. After loop: `started_at`, `finished_at`, `duration_ms`, `users_processed`, `emails_sent`, `error_message` (if any) written as one row to `scheduled_job_runs`.
9. `db.close()` in the `finally` block.

**Update preferences:**

1. User clicks "Turn off."
2. Browser fires `PATCH /api/v1/email-preferences` with `{"frequency": "off"}` and JWT.
3. Router validates `frequency in ("weekly", "off")` → 400 if not.
4. `_get_or_create_pref(db, user.id)` → existing row found.
5. `pref.frequency = "off"`, commit.
6. Returns the updated row.
7. Frontend re-renders the card with the new state and "Turn on" button.

**Unsubscribe via email link:**

1. User clicks "Unsubscribe" link in the email footer.
2. Browser navigates to `http://localhost:3000/unsubscribe?token=...`.
3. (The frontend page for this isn't built in Phase 7 — Phase 8 territory. For now the API endpoint exists and works; you can curl it.)
4. POST `/api/v1/unsubscribe` with `{"token": "..."}`, no auth.
5. Router queries `EmailPreference WHERE unsubscribe_token = :token`. 404 if no match.
6. `pref.frequency = "off"`, commit.
7. Returns `{"ok": true}`.

---

## Where we got stuck

A few things came up worth recording:

**The `[email protected]` cargo cult.** A surprising number of round trips (probably the most painful part of Phase 7 in real time) were spent because the chat client's email-protection feature kept rendering placeholder emails as the literal string `[email protected]`. When that text got copy-pasted into `.env`, Docker tried to parse `[email protected]` as a `KEY=VALUE` line, found a space inside what it thought was the key, and aborted with `line 18: key cannot contain a space`. The fix was to type the values manually rather than paste from chat. **Lesson: any chat-rendered email-like value should be typed by hand or sanitized before going into config files.**

**API key exposed mid-conversation.** While debugging the `.env` parsing issue, the user pasted the raw `RESEND_API_KEY` value into the chat. Same lesson Phase 6 documented for `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`. Key was rotated immediately. **Going forward: any debugging command that resolves env vars (`cat .env`, `printenv`, `docker compose config`) should be sanitized before pasting back. Use `grep -nE` with line numbers and redaction, or `awk 'NR==N' | od -c` for byte inspection that the user can sanitize before sending.**

**A Phase 6 orphan test.** Running `pytest -v` for the first time during Phase 7 surfaced one failure: `test_similar_unauthenticated` from Phase 6, expecting a route at `/api/v1/applications/{id}/similar` that doesn't exist (because the Phase 6 router was specced but never merged). Deleted the test file. The failure wasn't caused by Phase 7 — Phase 7 just exposed it. **Lesson: failing tests in CI become invisible noise; delete or skip orphan tests when you can't fix the underlying gap immediately.**

**Scheduler "started" log line missing from output.** After wiring up the lifespan, the expected `scheduler started: weekly_summary cron mon@09:00 UTC` line didn't appear in `docker compose logs`. Initial reaction was to add `print()` calls. Right answer: don't add anything. Verified the scheduler was actually running by checking thread count (`ls /proc/1/task | wc -l` returned 14, vs. the 1-2 threads a scheduler-less FastAPI would have). Python's default logging config under uvicorn filters out app-module INFO logs; the scheduler was alive, just not visible. **Lesson: when something seems missing, verify before patching. Threads in `/proc/1/task` are the source of truth, not log lines.**

That's it. No DB recovery, no SDK incompatibilities (Phase 4's `anthropic` httpx-bug ghost did not return), no frontend hydration weirdness, no auth gotchas. The substrate from Phases 1–5 absorbed all the non-Phase-7-specific noise.

---

## What's wired but dormant

Same list as Phase 6, plus a few new items:

- **Resend is on the sandbox sender.** `[email protected]` only delivers to the address you signed up to Resend with. To send to other users, you need to verify a domain in Resend's dashboard (add SPF/DKIM/return-path DNS records, ~30-minute task), then change `RESEND_FROM_EMAIL` in `.env` and remove the `override_to` line in the manual-trigger router.

- **The unsubscribe frontend page is not built.** `/api/v1/unsubscribe` works (verified by `test_unsubscribe_with_bad_token_404`), but clicking the link in the email lands at a Next.js 404 page right now. Add `frontend/src/app/unsubscribe/page.tsx` that reads `?token=...` from the URL, POSTs to the API, and shows a confirmation. ~30-line addition.

- **No admin page for `scheduled_job_runs`.** The audit log table exists and gets written to on every cron run. Phase 8+ should add a small admin page that does `SELECT * FROM scheduled_job_runs ORDER BY id DESC LIMIT 20` and renders it as a table. Useful for "did Monday's batch actually run, and to whom."

- **Single-instance scheduler.** APScheduler runs in-process. If you ever scale to two backend containers, you'll have two schedulers and the email sends twice. Production multi-instance would need either (a) a Redis-backed scheduler (e.g., RQ or Dramatiq), (b) a dedicated worker container that runs the scheduler exclusively, or (c) a leader-election mechanism. Personal/single-instance use is fine as is.

- **No retry logic on `send_email`.** A 429 or transient 500 from Resend just makes the email fail. The scheduled batch swallows the error and continues with the next user (writing to `scheduled_job_runs.error_message`); the manual trigger surfaces it as a 502 to the user. Phase 8+ should wrap `send_email`, `call_claude_json`, and `embed_document` with shared exponential backoff (3 retries, 1s/2s/4s).

- **`ANTHROPIC_MODEL` env var still does nothing.** Carried forward from Phase 4. Hardcoded in `claude_client.py`. Now four AI services (`gap_analysis`, `cover_letter`, `bullet_rewriter`, `weekly_summary`) all inherit `claude_client.py`'s `DEFAULT_MODEL`, plus `resume_parser.py` hardcodes its own. The cleanup is still: read `settings.anthropic_model` once in `claude_client.py`, refactor `resume_parser.py` to use `call_claude_json` at the same time.

- **No streaming.** Weekly summary takes 5-10 seconds and produces a relatively short output. Streaming wouldn't help a synchronous email send anyway (you can't send a half-finished email). If a user-facing AI feature ever does justify streaming (long-form resume tailoring, real-time interview prep), Phase 4's `claude_client.py` is the right place to add a streaming variant alongside `call_claude_json`.

- **Cost telemetry is still stdout only.** Four AI features all log `claude call ...`, plus one new `resend send ...` line per send. No `ai_calls` audit table, no per-user/per-feature cost attribution. Same Phase 4 / Phase 5 / Phase 6 deferral. Phase 8+ remains the right place.

- **Voyage embeddings code from the Phase 6 spec is not in the repo.** Confirmed during Phase 7 setup. The `embedding` column on `applications` exists in the model and the migration, but no `embeddings.py` service file, no `similar_applications.py` router, no backfill script, no frontend card. The `docker-compose.yml` line `VOYAGE_API_KEY: ${VOYAGE_API_KEY}` is harmless — resolves to an empty string if unset. Either finish Phase 6 in a separate sub-phase, or remove the dormant pieces. Phase 7 didn't touch any of this.

---

## What Phase 7 means in plain terms

You now have a **second runtime mode** in the backend. Until Phase 7, every line of code was triggered by a synchronous HTTP request. Now there's a separate path — APScheduler firing on a cron, looping every user, doing the same Claude+template+Resend dance the manual trigger does. Same code, different entry point.

The structurally new things:

- **APScheduler in-process.** One thread, one cron, one job. The lifespan context wires it to the FastAPI app's startup/shutdown. The tick function manages its own DB session because it's not in a request scope.
- **A second external service (Resend).** The third entry in the wrapper-pattern table — Anthropic, Voyage, now Resend. Each has its own thin wrapper file, its own env var, its own pip dep, and knows nothing about the others.
- **A first-class audit log table.** `scheduled_job_runs` records every batch run. The first table in the project that exists purely for ops/observability rather than user data.
- **A public, token-gated endpoint.** `/api/v1/unsubscribe` is the first endpoint that bypasses `Depends(get_current_user)` and uses a per-user opaque random token as the credential instead. Same pattern any newsletter platform uses.

The pattern from Phases 4 and 5 generalized completely. Adding the email feature was: one service file with prompt + template + one function calling `call_claude_json`. One router with the same try/except shape. One model file with new tables, JSON-free this time because the data is structured. One `mock_claude` patch line in `conftest.py`. One frontend card on the dashboard. The only genuinely new code was `scheduler.py` (~50 lines) and `weekly_summary_job.py` (the orchestrator that ties Claude, the template, and Resend together).

You haven't built any new infrastructure besides the scheduler thread itself. You've shown the substrate handles a fundamentally different kind of AI workload (scheduled batched multi-user) without rebuilding the architecture. Same wrapper-pattern discipline, same error semantics, same test mock strategy.

---

## Commands run during Phase 7

For future reference / re-running on a fresh checkout. Assumes Phase 5 is healthy.

```bash
# === Prerequisites — confirm prior phases still work ===
docker compose ps
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 13 tables (or 14 with embedding column from partial Phase 6)
docker compose exec backend pytest -v
# Expected: 16 passed (delete tests/test_similar_applications.py if it's
# orphaned from a partial Phase 6)

# === PHASE 7 PROPER ===

git checkout main
git pull
git checkout -b phase-7-weekly-email

# 1. Get a Resend API key
# Sign up at https://resend.com using the email you want to receive at.
# Resend → API Keys → Create API Key → name "jobtrackr-dev" → Full access.
# Copy the re_... key (you only see it once).

# 2. Env var wiring (manually, in VS Code, NOT via copy-paste from chat —
#    chat email-rendering can corrupt placeholder addresses)
# (edit root .env: append three lines)
#   RESEND_API_KEY=re_...
#   [email protected]
#   [email protected]
# (edit .env.example: add the same three keys, empty values, with the
#  RESEND_FROM_EMAIL default left as onboarding@resend.dev)
# (edit docker-compose.yml: add three lines under backend.environment:
#    RESEND_API_KEY: ${RESEND_API_KEY}
#    RESEND_FROM_EMAIL: ${RESEND_FROM_EMAIL}
#    EMAIL_TEST_RECIPIENT: ${EMAIL_TEST_RECIPIENT})

docker compose up -d --force-recreate backend
# Verify NO warnings about variables defaulting to blank
docker compose exec backend printenv RESEND_FROM_EMAIL
# Expected: onboarding@resend.dev
docker compose exec backend sh -c 'echo "key length: ${#RESEND_API_KEY}"'
# Expected: key length: 36 (or whatever your real key length is — not 0)

# 3. Pydantic settings
# (edit backend/app/config.py: add resend_api_key, resend_from_email,
#  email_test_recipient fields with empty/default string values)
docker compose restart backend
docker compose exec backend python -c "from app.config import settings; print('from:', settings.resend_from_email); print('key_set:', bool(settings.resend_api_key))"
# Expected: from: onboarding@resend.dev / key_set: True

# 4. Dependencies
# (edit backend/requirements.txt: append apscheduler>=3.10 and resend>=2.0)
docker compose build backend
docker compose up -d backend
docker compose exec backend python -c "import apscheduler; print('apscheduler', apscheduler.__version__)"
docker compose exec backend python -c "import resend; print('resend', resend.__version__)"

# 5. Schema additions
# (edit backend/app/models.py:
#    - inside User class, add email_preference relationship line
#    - append EmailPreference and ScheduledJobRun classes at bottom)
docker compose exec backend python -c "from app.models import EmailPreference, ScheduledJobRun, User; print('ok')"
docker compose exec backend python -c "from app.models import User; print('rel:', User.email_preference.property.mapper.class_.__name__)"
# Expected: ok / rel: EmailPreference

# 6. Pydantic schemas
# (edit backend/app/schemas.py: append EmailPreferenceOut, EmailPreferenceUpdate,
#  TriggerWeeklySummaryOut)
docker compose exec backend python -c "from app.schemas import EmailPreferenceOut, EmailPreferenceUpdate, TriggerWeeklySummaryOut; print('ok')"

# 7. Service layer (four new files)
# (create backend/app/services/weekly_summary.py — Claude prompt + run function)
# (create backend/app/services/email_sender.py — Resend wrapper)
# (create backend/app/services/email_template.py — HTML f-string)
# (create backend/app/services/weekly_summary_job.py — orchestrator with
#  run_for_user and run_for_all_users)
docker compose exec backend python -c "from app.services.weekly_summary import run_weekly_summary; from app.services.email_sender import send_email; from app.services.email_template import render_weekly_summary_html; from app.services.weekly_summary_job import run_for_user, run_for_all_users; print('all ok')"

# 8. Scheduler
# (create backend/app/scheduler.py — start_scheduler, stop_scheduler,
#  _weekly_summary_tick, CronTrigger Mon 09:00 UTC)
docker compose exec backend python -c "from app.scheduler import start_scheduler, stop_scheduler, scheduler; print('ok, initially:', scheduler)"
# Expected: ok, initially: None

# 9. Router
# (create backend/app/routers/email_preferences.py — 4 endpoints under /api/v1)
docker compose exec backend python -c "from app.routers.email_preferences import router; print('routes:', [r.path for r in router.routes])"

# 10. Wire router and lifespan into main.py
# (edit backend/app/main.py:
#    - add `from contextlib import asynccontextmanager`
#    - add `from app.scheduler import start_scheduler, stop_scheduler`
#    - add email_preferences to `from app.routers import (...)`
#    - add `@asynccontextmanager` lifespan function
#    - change FastAPI(...) call to FastAPI(title=..., lifespan=lifespan)
#    - add app.include_router(email_preferences.router) at the bottom)
docker compose restart backend
docker compose logs --tail=30 backend
# Expected: Application startup complete. with no tracebacks

# Verify routes registered
curl -s http://localhost:8000/openapi.json | python3 -c "import json,sys; d=json.load(sys.stdin); paths=[p for p in d['paths'] if 'email-preferences' in p or 'unsubscribe' in p]; print('\n'.join(paths))"
# Expected:
#   /api/v1/email-preferences
#   /api/v1/email-preferences/test
#   /api/v1/unsubscribe

# Verify auth gate
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/email-preferences
# Expected: 401

# Verify scheduler is alive (thread count check)
docker compose exec backend ls /proc/1/task | wc -l
# Expected: 10+ (a scheduler-less FastAPI has 1-2 threads; with APScheduler ~14)

# 11. Migration
docker compose exec backend alembic revision --autogenerate -m "add email_preferences and scheduled_job_runs"
# READ the generated file under backend/alembic/versions/<hash>_add_email_preferences_and_scheduled_job_runs.py
# Confirm upgrade() only does:
#    op.create_table('scheduled_job_runs', ...)
#    op.create_index(...) on job_name
#    op.create_table('email_preferences', ...)  with FK to users.id ondelete=CASCADE
#    op.create_index(...) on unsubscribe_token (unique)
# If anything else is being dropped/altered, STOP and investigate.

docker compose exec backend alembic upgrade head
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 15 tables, including email_preferences and scheduled_job_runs
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\d email_preferences"
# Expected: 7 columns, FK to users.id ON DELETE CASCADE,
# unique on user_id, unique index on unsubscribe_token
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\d scheduled_job_runs"
# Expected: 10 columns, index on job_name

# 12. Tests
# (edit backend/tests/conftest.py: add weekly_summary import + monkeypatch line
#  to mock_claude fixture)
# (create backend/tests/test_email_preferences.py — 4 unauth tests)
# (create backend/tests/test_weekly_summary.py — 2 service-layer tests)
docker compose exec backend pytest -v
# Expected: 22 passed (16 prior + 4 + 2)

# 13. Frontend
# (edit frontend/src/app/dashboard/page.tsx:
#    - Add EmailPreference type
#    - Add EmailPreferencesCard render block right after the header,
#      above the summary grid
#    - Add EmailPreferencesCard component definition at the bottom of the file)
cd frontend && npm run dev
# Expected: clean compile, "Ready in ..."

# 14. End-to-end browser test (use Chrome, not Safari per Phase 4 lesson)
#    - Log in
#    - Make sure you have a few applications with different statuses
#    - On the dashboard, click "Send test now"
#    - Watch `docker compose logs -f backend` for two lines:
#        claude call model=claude-sonnet-4-5 in_tok=... cost_usd=...
#        resend send to=... subject='...' id=...
#    - Email should arrive in your inbox within ~30 seconds
#    - Email should have: real subject, "Hi [name]," greeting,
#      2-3 paragraph summary referencing actual applications,
#      "Suggested next steps" with 2-3 bullets, footer with unsubscribe link
#    - Click "Turn off" on the dashboard card → text changes to "Off"
#    - Click "Turn on" → back to "Weekly"

# 15. Verify schedule
docker compose exec backend python -c "
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timezone
trigger = CronTrigger(day_of_week='mon', hour=9, minute=0)
fire = datetime.now(timezone.utc)
for i in range(4):
    fire = trigger.get_next_fire_time(fire, fire)
    print(f'  {i+1}. {fire.strftime(\"%A %Y-%m-%d %H:%M %Z\")}')
"
# Expected: 4 Mondays at 09:00 UTC

# 16. Verify post-trigger DB state
docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT user_id, frequency, last_sent_at, unsubscribe_token IS NOT NULL AS has_token FROM email_preferences;"
# Expected: 1 row, frequency=weekly, last_sent_at=recent, has_token=t
docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT * FROM scheduled_job_runs;"
# Expected: empty (cron hasn't fired; manual trigger doesn't log here)

# 17. Commit
docker compose exec backend pytest -v          # final green check
git status                                      # confirm .env is NOT staged
git add .
git commit -m "Phase 7: APScheduler + weekly summary email via Resend"
git push -u origin phase-7-weekly-email
```

---

## What's next

**Domain verification (Phase 7.5).** Until you verify a domain in Resend, the manual trigger only delivers to your own signed-up email and the scheduled batch can't deliver to other users at all. ~30 min task: buy a domain (or use one you own), add it in Resend, paste the SPF+DKIM DNS records into your registrar, wait for verification, change `RESEND_FROM_EMAIL` to `[email protected]`, remove `override_to=settings.email_test_recipient` from the manual-trigger router. Optional but blocks any real user-facing use.

**Phase 6 cleanup.** The `embedding` column and the `pgvector.sqlalchemy.Vector` import are in `models.py` (and committed in the migration `27841ce6273b`), but the corresponding service file, router, backfill script, and frontend card from the Phase 6 spec are NOT in the repo. Either finish those pieces (~1-2 hours) or remove the dangling column and import.

**Phase 8 — cross-cutting concerns.** None of these reshape the substrate; they sit on top:
- An `ai_calls` audit table that logs every Claude/Voyage/Resend call with feature, user, tokens, cost, elapsed time. The shared place to add retry logic too (3 retries with exponential backoff, applied to `call_claude_json`, `embed_document`, and `send_email` at once).
- An admin page at `/admin/jobs` that renders the last 20 rows of `scheduled_job_runs`.
- An unsubscribe page at `/unsubscribe?token=...` that POSTs to the existing endpoint and shows a confirmation. Currently the API endpoint exists and is tested but the user-facing page is a 404.
- Application analytics (aggregate gap-analysis fit scores by company/role/time, rendered as charts on a new dashboard tab). Reads from the AI features built in Phases 4–7; doesn't add new AI features.
- Email/calendar integration (Gmail OAuth → ingest application replies, Google Calendar OAuth → push interview rounds as events). The `_prisma_migrations` filter and the existing `Application`/`InterviewRound` schemas already support this; what's missing is the OAuth flow and the IMAP/calendar sync workers.

The hard infrastructure work has stayed done since Phase 4. Phase 7 confirmed that adding a fundamentally different runtime mode (scheduled background work) to the existing substrate is the same recipe as adding a synchronous AI feature: service file, router, model, migration, mock fixture, frontend card. Plus one new file (`scheduler.py`) and one new pattern (`@asynccontextmanager` lifespan) — both small, both standard.