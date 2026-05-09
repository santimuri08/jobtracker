# Phase 6 — Semantic Search with pgvector

## What Phase 6 set out to do

Phases 4 and 5 built the *generation* substrate (Claude wrapper, service-file pattern, mocked tests, error semantics). Phase 6 introduces a **different mental model entirely**: embeddings. Instead of asking an LLM to write something, we ask an embedding model to convert each application into a numeric "fingerprint" — a 1024-dimensional vector — that captures its semantic content. Two applications whose JDs talk about similar things get vectors that point in similar directions, and we measure that with cosine distance entirely inside Postgres.

The "done when" criteria were: embed every application's job description automatically on save; backfill embeddings for existing applications; expose a search endpoint that returns the user's most-similar applications ranked by cosine similarity; render a card on the application detail page that shows the top matches with similarity percentages. All of that now works.

The substrate from Phase 4 stayed exactly as it was — `claude_client.py` and the `mock_claude` fixture were not touched. **Voyage is a separate, parallel service**: a new wrapper file (`embeddings.py`), a new env var (`VOYAGE_API_KEY`), and a single new dependency (`voyageai`). The two providers don't know about each other.

---

## The mental model

Three things make Phase 6 distinct from earlier AI phases:

**1. A second AI provider.** Anthropic doesn't make embeddings — their docs explicitly recommend Voyage AI as the embeddings partner. So Phase 6 introduces `voyage-3-large` (1024 dims) for embeddings, while Claude continues to handle every generation feature. Both providers are accessed through the same service-layer pattern — there's a `claude_client.py` (Phase 4) and now an `embeddings.py` (Phase 6), each wrapping its respective SDK.

**2. Embeddings are written, not generated.** Every other AI feature is a request → response loop: user clicks button, Claude streams text back, we render it. Embeddings are different — they're written once when the row is created (or its text changes), stored as a column, and then *queried* with database math. The "search" call doesn't talk to any external service; it's a single SQL query using pgvector's cosine-distance operator (`<=>`). This means searches are effectively free and instant; only writes cost money.

**3. The new column is a real database type, not JSON.** `applications.embedding` is `vector(1024)` — a pgvector-native type with operators built into Postgres. We can't just add the column with a normal Alembic autogenerate and expect it to work; pgvector needs to be installed both as a Postgres extension (server-side, one-time) and as a Python package (client-side, in requirements). The migration also needs an extra import line that autogenerate forgets to add.

The data model is deliberately conservative: one new nullable column on the existing `applications` table, no new tables. JDs are the only thing we embed — not resumes, not cover letters, not user-generated text. Keeping the embedding scope tight means the search results are about *role similarity*, not "this user once typed Python somewhere," which is what people actually want when they ask "find similar roles to this one."

---

## What's running right now

Same Phase 5 stack with two additions: the pgvector extension is enabled in Postgres, and a second SDK (`voyageai`) is installed in the backend container. One new column (`applications.embedding`), one new service file, one new router file, one new test file, one updated frontend file (the application detail page now hosts a fourth card alongside gap analysis, cover letter, and bullet rewriter).

The full save-and-search round trip:

User creates or edits an application with a JD → `POST /applications` (or `PATCH /applications/{id}`) → router calls `_maybe_embed(app_obj)` → if there's a JD, `build_application_text(...)` produces a canonical `Role: ... \nCompany: ... \nLocation: ... \nDescription: ...` string → `embed_document(text)` calls Voyage's `/v1/embed` with `input_type="document"` → 1024 floats come back, stored as `embedding` column on the row. Total cost: ~10ms inside Postgres + 200–500ms network round-trip to Voyage.

When the user clicks "Find similar roles" on an application detail page → `GET /applications/{id}/similar?limit=5` → router fetches the source application's embedding from the database → builds a SQL query using `Application.embedding.cosine_distance(source.embedding)` (which generates `embedding <=> :param`) → ranks all the user's *other* applications with non-null embeddings by ascending distance → returns the top 5 with similarity = `1 - distance`. **No Voyage call on read.** Total cost: one DB query, no API spend.

Every endpoint enforces `application.user_id == current_user.id`, same as every other phase. No path lets one user search another user's applications.

---

## File-by-file walkthrough

### Backend

**`.env`** (modified)

One new line at the bottom:

```
VOYAGE_API_KEY=pa-...
```

Voyage's free tier (200M tokens) is way more than this app needs. The key is gitignored in `.env`; the empty `VOYAGE_API_KEY=` placeholder lives in `.env.example` for the template.

**`docker-compose.yml`** (modified)

One new line in the `backend.environment` block:

```yaml
      VOYAGE_API_KEY: ${VOYAGE_API_KEY}
```

This forwards the host's `.env` value into the container. Without it, the container can't see the key even though it's in `.env`.

**`backend/app/config.py`** (modified)

One new line in the `Settings` class:

```python
voyage_api_key: str = ""
```

Empty default, same pattern as `anthropic_api_key`. The backend starts fine without the key; only embedding calls fail with a clear `RuntimeError` if the key isn't set.

**`backend/requirements.txt`** (modified)

Two new lines at the bottom:

```
voyageai>=0.3.0
pgvector>=0.4.0
```

`voyageai` is the official Voyage SDK. `pgvector` (the Python package) was already pinned earlier in the locked-deps block from Phase 0 (`pgvector==0.4.2`); the looser `pgvector>=0.4.0` line here makes the dependency explicit. Pip handles the duplicate gracefully — the pinned version satisfies the looser constraint.

After editing, ran `docker compose build backend` to rebuild the image.

**`backend/app/services/embeddings.py`** (new, the most important file in Phase 6)

The reusable wrapper. Same shape and intent as `claude_client.py` from Phase 4 — every embedding call goes through this module instead of touching the Voyage SDK directly. Centralizes API key handling, model + dimension constants, batch handling, and the `build_application_text` helper that defines the canonical text we embed per application.

```python
# backend/app/services/embeddings.py
"""
Thin wrapper around the Voyage AI embeddings SDK.

Used by the application semantic-search feature. Centralizes:
  - API key handling
  - Model + dimension constants
  - Batch handling

Anthropic does not provide embeddings; Voyage is their recommended partner.
"""
from __future__ import annotations

import logging
from typing import Iterable

import voyageai

from app.config import settings

logger = logging.getLogger(__name__)

# voyage-3-large -> 1024 dims; good general-purpose retrieval model.
EMBEDDING_MODEL = "voyage-3-large"
EMBEDDING_DIM = 1024


def _client() -> voyageai.Client:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set")
    return voyageai.Client(api_key=settings.voyage_api_key)


def embed_document(text: str) -> list[float]:
    """Embed a single piece of text as a 'document' (the thing being searched)."""
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")
    client = _client()
    result = client.embed(
        texts=[text.strip()],
        model=EMBEDDING_MODEL,
        input_type="document",
    )
    vec = result.embeddings[0]
    logger.info(
        "voyage embed model=%s input_type=document chars=%d",
        EMBEDDING_MODEL, len(text),
    )
    return vec


def embed_query(text: str) -> list[float]:
    """Embed a single piece of text as a 'query' (the thing we're searching with)."""
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")
    client = _client()
    result = client.embed(
        texts=[text.strip()],
        model=EMBEDDING_MODEL,
        input_type="query",
    )
    vec = result.embeddings[0]
    logger.info(
        "voyage embed model=%s input_type=query chars=%d",
        EMBEDDING_MODEL, len(text),
    )
    return vec


def embed_documents_batch(texts: Iterable[str]) -> list[list[float]]:
    """Embed many documents at once. Used by the backfill script."""
    cleaned = [t.strip() for t in texts if t and t.strip()]
    if not cleaned:
        return []
    client = _client()
    result = client.embed(
        texts=cleaned,
        model=EMBEDDING_MODEL,
        input_type="document",
    )
    logger.info(
        "voyage embed batch model=%s input_type=document n=%d",
        EMBEDDING_MODEL, len(cleaned),
    )
    return list(result.embeddings)


def build_application_text(
    company: str | None,
    role: str | None,
    location: str | None,
    job_description: str | None,
) -> str:
    """
    Build the canonical text we embed per application.
    Keep this consistent across save and backfill so vectors are comparable.
    """
    parts = []
    if role:
        parts.append(f"Role: {role}")
    if company:
        parts.append(f"Company: {company}")
    if location:
        parts.append(f"Location: {location}")
    if job_description:
        parts.append(f"Description: {job_description}")
    return "\n".join(parts).strip()
```

The `document` vs `query` distinction matters for retrieval quality — Voyage's embeddings are direction-aware, so embedding the saved JDs as documents and the search query as a query gives meaningfully better results than treating them the same. We don't actually use `embed_query` in Phase 6 (search is application-id-based, so we just pull the source's pre-computed embedding from the DB), but it's there for future features (free-text search, "paste a JD and find matches").

`build_application_text` exists for one reason: **consistency**. The exact same function gets used by `_maybe_embed` (on save) and the backfill script (for legacy rows). If save embeds `"Role: ...\nCompany: ..."` and backfill embeds `"Company: ...\nRole: ..."`, the vectors aren't comparable and search quality silently degrades. Centralizing the text construction prevents that drift.

**`backend/app/models.py`** (modified)

Two small edits:

1. New import directly under `from sqlalchemy.orm import relationship`:
   ```python
   from pgvector.sqlalchemy import Vector
   ```

2. Inside the `Application` class, one new column between `updated_at` and the relationships:
   ```python
   embedding = Column(Vector(1024), nullable=True)
   ```

`nullable=True` is critical — existing applications won't have one until the backfill runs, and applications without a job description will permanently stay `NULL`. The search endpoint filters them out via `Application.embedding.is_not(None)`.

**`backend/alembic/versions/27841ce6273b_add_embedding_column_to_applications.py`** (generated, then manually patched)

The Phase 6 migration. Alembic autogenerated this with one missing import — the upgrade body referenced `pgvector.sqlalchemy.vector.VECTOR(...)` but `pgvector` wasn't imported at the top of the file, so the migration would fail with `NameError: name 'pgvector' is not defined`. Fix: manually add `import pgvector.sqlalchemy` after the `import sqlalchemy as sa` line. This is a known minor issue with Alembic + pgvector autogenerate.

Final file:

```python
"""add embedding column to applications

Revision ID: 27841ce6273b
Revises: ef94b50389b6
Create Date: 2026-05-09 06:30:34.638359

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


# revision identifiers, used by Alembic.
revision: str = '27841ce6273b'
down_revision: Union[str, Sequence[str], None] = 'ef94b50389b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('applications', sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1024), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applications', 'embedding')
```

`down_revision = 'ef94b50389b6'` correctly points at Phase 5's `cover_letters` migration. The autogenerate run was clean otherwise — no surprise drops, alters, or false positives, including the Phase 4 `_prisma_migrations` filter still doing its job.

**`backend/app/routers/applications.py`** (modified, bigger change than the others)

Three additions to the existing CRUD router:

1. New imports at the top:
   ```python
   import logging
   from app.services.embeddings import build_application_text, embed_document
   ```

2. New helper function `_maybe_embed(app_obj)` that handles the "embed if there's enough text, never crash on errors" logic. Sets `app_obj.embedding = None` when there's no JD; sets it to a 1024-float vector when there is; logs a warning and falls back to `None` if Voyage errors out.

3. `create_application` now calls `_maybe_embed(app_obj)` before `db.add()`. `update_application` switches to `payload.model_dump(exclude_unset=True)` first, checks whether any of `{company, role, location, job_description}` actually changed, and only re-embeds if so. Status changes, salary updates, and resume swaps don't trigger re-embedding.

The "embedding failures don't break saves" rule matters. If Voyage is down, having `POST /applications` fail with a 5xx is worse than letting the row save with `embedding=NULL` — the user can re-save later to retry, and CRUD never depends on an external service being up. The warning shows up in `docker compose logs backend` so it's visible without spamming the user.

**`backend/app/routers/similar_applications.py`** (new)

The actual search endpoint. One route, one query, returns ranked results with similarity scores.

```python
# backend/app/routers/similar_applications.py
"""
Semantic-search endpoint: given an application id, return other applications
belonging to the same user that are most similar by job-description embedding.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import CurrentUser, get_current_user
from app.models import Application

router = APIRouter(
    prefix="/api/v1/applications/{application_id}/similar",
    tags=["similar_applications"],
)


class SimilarApplicationOut(BaseModel):
    id: int
    company: str
    role: str
    location: str | None = None
    status: str
    similarity: float    # 0.0 (orthogonal) .. 1.0 (identical)


@router.get("", response_model=list[SimilarApplicationOut])
def list_similar(
    application_id: int,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    # 1. Source app must exist, belong to this user, and have an embedding.
    source = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user.id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=404, detail="Application not found")
    if source.embedding is None:
        raise HTTPException(
            status_code=400,
            detail="This application has no embedding yet (add a job description first).",
        )

    # 2. Cosine distance via pgvector's <=> operator.
    #    distance is in [0, 2]; similarity = 1 - distance, clamped to [0, 1].
    distance = Application.embedding.cosine_distance(source.embedding).label("distance")

    rows = (
        db.query(Application, distance)
        .filter(Application.user_id == user.id)
        .filter(Application.id != application_id)
        .filter(Application.embedding.is_not(None))
        .order_by(distance.asc())
        .limit(limit)
        .all()
    )

    out: list[SimilarApplicationOut] = []
    for app_obj, dist in rows:
        sim = max(0.0, min(1.0, 1.0 - float(dist)))
        out.append(
            SimilarApplicationOut(
                id=app_obj.id,
                company=app_obj.company,
                role=app_obj.role,
                location=app_obj.location,
                status=app_obj.status.value,
                similarity=sim,
            )
        )
    return out
```

Three filters in the query, each load-bearing:
- `Application.user_id == user.id` — data isolation, same as every other phase
- `Application.id != application_id` — exclude the source app itself, otherwise it'd self-match at 100%
- `Application.embedding.is_not(None)` — exclude apps with no JD, otherwise they pollute results with garbage distances

`Application.embedding.cosine_distance(...)` is a method that pgvector's SQLAlchemy integration adds to vector columns. It generates the SQL `embedding <=> :param`, where `<=>` is pgvector's cosine-distance operator. Distance is in [0, 2]; we sort ascending and convert to similarity = `1 − distance`, clamped to [0, 1] for safety, so the UI can format it as a percentage.

Three error codes possible: 401 (no auth, from the dependency), 404 (app doesn't exist or isn't yours), 400 (app exists but has no embedding). 502/500 don't apply because there's no external API call.

**`backend/app/main.py`** (modified)

Two-line change. Added `similar_applications` to the `from app.routers import (...)` block, and one `app.include_router(similar_applications.router)` call at the bottom.

**`backend/app/scripts/__init__.py`** (new, empty)

Marks `scripts/` as a Python package so `python -m app.scripts.backfill_embeddings` works.

**`backend/app/scripts/backfill_embeddings.py`** (new)

One-shot script for legacy rows. Finds every application that has a `job_description` but no `embedding`, builds the canonical text via `build_application_text` (same function the save path uses), sends them to Voyage in batches of 16, writes the vectors back. Idempotent — running it again is a no-op.

```python
# backend/app/scripts/backfill_embeddings.py
"""
One-shot script: embed every application that has a job_description
but no embedding yet.

Run with:
    docker compose exec backend python -m app.scripts.backfill_embeddings
"""
from app.database import SessionLocal
from app.models import Application
from app.services.embeddings import (
    build_application_text,
    embed_documents_batch,
)

BATCH_SIZE = 16


def main() -> None:
    db = SessionLocal()
    try:
        apps_to_embed = (
            db.query(Application)
            .filter(Application.embedding.is_(None))
            .filter(Application.job_description.isnot(None))
            .filter(Application.job_description != "")
            .all()
        )

        if not apps_to_embed:
            print("Nothing to backfill — every JD-bearing application already has an embedding.")
            return

        print(f"Backfilling {len(apps_to_embed)} applications in batches of {BATCH_SIZE}...")

        for i in range(0, len(apps_to_embed), BATCH_SIZE):
            chunk = apps_to_embed[i : i + BATCH_SIZE]
            texts = [
                build_application_text(
                    company=a.company,
                    role=a.role,
                    location=a.location,
                    job_description=a.job_description,
                )
                for a in chunk
            ]
            vectors = embed_documents_batch(texts)
            for a, vec in zip(chunk, vectors):
                a.embedding = vec
            db.commit()
            print(f"  ✓ {min(i + BATCH_SIZE, len(apps_to_embed))} / {len(apps_to_embed)}")

        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

Batch size of 16 is conservative — Voyage allows up to 128 per request. With dozens of applications this hits Voyage once, maybe twice. Database invariant after running: `count(embedding) == count(*) FILTER (WHERE job_description IS NOT NULL AND job_description <> '')`.

**`backend/tests/test_similar_applications.py`** (new)

One smoke test: POST without a token returns 401. Same shape as the unauthenticated tests for gap analysis, cover letters, and bullet rewrites — proves the route is wired and the auth gate works without needing a seeded database.

Total test count after Phase 6: **17 passing** (was 16 after Phase 5, +1 here).

**`backend/tests/conftest.py`** (NOT modified)

Worth calling out explicitly: the `mock_claude` fixture didn't change. Every Phase 4/5 service uses Claude and goes through `mock_claude`. Phase 6 uses Voyage, which doesn't have a mock fixture — but the only Phase 6 test is an unauthenticated-401 test that never gets far enough to call Voyage anyway. If a future phase adds Voyage-using tests, we'll need a parallel `mock_voyage` fixture.

### Frontend

**`frontend/src/app/applications/[id]/page.tsx`** (modified)

Three additions to the existing application detail page:

1. **One new type** at the top of the file (alongside the existing `AppDetail`, `Round`, `Contact`, `Note`, `ExperienceGap`, `GapAnalysis`, `CoverLetter`, `BulletVariant`, `BulletRewriteResult`):
   ```tsx
   type SimilarApp = {
     id: number
     company: string
     role: string
     location: string | null
     status: string
     similarity: number
   }
   ```

2. **One new render block** in the JSX, placed between the existing `<CoverLetterCard>` and `<BulletRewriterCard>` blocks:
   ```tsx
   {session?.backendToken && (
     <SimilarApplicationsCard
       applicationId={appData.id}
       token={session.backendToken}
       hasJobDescription={!!appData.job_description}
     />
   )}
   ```

3. **One new component definition** at the bottom of the file, alongside the other card components.

   **`SimilarApplicationsCard`** — small state machine. On mount, does nothing (we don't auto-search, since each search is a DB query). The user clicks "Find similar roles" → POST → store result in component state → render. If `hasJobDescription` is false, the button is replaced with grey explanatory text. Each result row has the role + company (linked to that application's detail page), location + status, and a big match percentage on the right. No persistence; refreshing the page clears the results.

The rest of the page (header, status dropdown, salary, JD details, gap analysis, cover letter, bullet rewriter, interview rounds, contacts, notes) is unchanged.

`Link` was already imported at the top of the file from earlier phases; no import changes were needed.

### Infrastructure

**Postgres extension.** The `pgvector/pgvector:pg16` Docker image *ships* the extension binary but doesn't auto-enable it in any database. We enabled it once with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Verified the extension is installed (`\dx` shows `vector | 0.8.2`) and that the type works (`SELECT '[1,2,3]'::vector;` returns the cast value).

No `docker-compose.yml` changes besides the one new env var line. The existing `pgvector/pgvector:pg16` image, the existing `jobtrackr_db_data` volume, and the existing pgvector Python package were all already in place from Phase 0 — Phase 6 just turned them on.

---

## How a typical request flows

**Save an application with a JD:**

1. Browser fires `POST http://localhost:8000/api/v1/applications` with `Authorization: Bearer <jwt>` and a body including `job_description`.
2. FastAPI routes to `applications.create_application`.
3. Handler builds the `Application` ORM object from the payload.
4. Calls `_maybe_embed(app_obj)`. Inside: `job_description` is non-empty, so it calls `build_application_text(company, role, location, job_description)` → returns `"Role: Senior Backend Engineer\nCompany: Stripe\nLocation: Remote\nDescription: We are looking for..."`.
5. Calls `embed_document(text)`. Inside: instantiates Voyage client, sends one HTTP POST to Voyage's API, ~200–500ms round trip. Returns a list of 1024 floats.
6. `app_obj.embedding = <list of 1024 floats>`.
7. `db.add(app_obj)`, `db.commit()`, `db.refresh(app_obj)`. Pgvector serializes the list into the `vector(1024)` column transparently.
8. Logs `voyage embed model=voyage-3-large input_type=document chars=NNN`.
9. Returns the row to the browser.

**Search for similar applications:**

1. Browser fires `GET /api/v1/applications/4/similar?limit=5` with the JWT.
2. FastAPI routes to `similar_applications.list_similar`.
3. Handler fetches the source app: `WHERE id=4 AND user_id=current_user.id`. 404 if missing or not yours; 400 if `embedding IS NULL`.
4. Builds the SQL: `SELECT applications.*, embedding <=> :source_vec AS distance FROM applications WHERE user_id = :user_id AND id != 4 AND embedding IS NOT NULL ORDER BY distance ASC LIMIT 5`.
5. Postgres executes the query entirely locally — no external calls. Cosine distance is computed across all the user's other applications. ~5–50ms even without an index.
6. Handler converts each row's `distance` into `similarity = max(0, min(1, 1 - distance))`.
7. Returns a list of `SimilarApplicationOut` objects.

**Update an application's status only:**

1. `PATCH /applications/4` with `{"status": "applied"}`.
2. Handler does `data = payload.model_dump(exclude_unset=True)` → `{"status": "applied"}`.
3. `text_changed = any(k in data for k in {"company", "role", "location", "job_description"})` → `False`.
4. Status is updated, no embedding regeneration. No Voyage call.

This last detail matters: status changes, salary edits, and resume swaps are common operations and shouldn't burn embedding tokens.

---

## Where we got stuck

Three things came up worth recording:

**API keys exposed mid-conversation.** Twice during Phase 6 I asked the user to run a diagnostic (`docker compose config`) that printed his real `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` to the terminal, which then got pasted into the chat. Both keys had to be rotated. The lesson: any debugging command that resolves env vars (compose config, `docker inspect`, `env | grep`) prints the secrets in plain text, and anything I ask the user to paste from terminal output should be sanitized first. From now on, secret-aware checks should use the safer pattern:

```bash
docker compose config --quiet && echo "ok"
# or:
docker compose config | grep -v -E "API_KEY|SECRET|PASSWORD"
```

**Alembic autogenerate forgot the pgvector import.** The autogenerated migration body referenced `pgvector.sqlalchemy.vector.VECTOR(...)` in `upgrade()`, but the file's import block only had `from alembic import op` and `import sqlalchemy as sa`. Running it as-is would fail with `NameError: name 'pgvector' is not defined`. This is a known minor issue with Alembic + pgvector — autogenerate emits the qualified type name without realizing it needs the corresponding import. Fix: one manually-added line, `import pgvector.sqlalchemy`, after `import sqlalchemy as sa`. **The Phase 3 instinct to read every autogenerated migration before applying it caught this; it would have failed loudly on `alembic upgrade head` otherwise.**

**Pylance squiggle on `import voyageai`.** VS Code's Python language server checks against the local Mac's `.venv`, not the container, so newly-installed Docker-only packages always trigger `reportMissingImports`. Same exact issue Phase 3 had with `pdfplumber` and `anthropic`. Fix: `cd backend && source .venv/bin/activate && pip install voyageai pgvector && deactivate`, then **Cmd+Shift+P → "Python: Restart Language Server"** in VS Code. Purely cosmetic — the running container is unaffected.

That's it. No DB recovery, no Phase 5 substrate breaks, no SDK incompatibilities, no hydration weirdness. The Phase 4 substrate continues to do its job — we added a parallel one for embeddings without touching it.

---

## What's wired but dormant

Same list as Phase 5, plus a few new items:

- **`ANTHROPIC_MODEL` env var still does nothing.** Carried forward from Phase 4. Hardcoded in `claude_client.py`. Phase 7+ should fix this once and update `resume_parser.py` to use `call_claude_json` at the same time.

- **No retry logic on `embed_document`.** Same pattern as `call_claude_json` — a 429 or transient 5xx from Voyage just makes the embedding call fail. The save still succeeds with `embedding=NULL` (because `_maybe_embed` swallows the exception), but the user has to re-save to retry. Wrapping both `call_claude_json` and `embed_document` with exponential backoff (3 retries, 1s/2s/4s) would handle it cleanly for both providers at once.

- **No HNSW index on `embedding`.** Pgvector supports `ivfflat` and `hnsw` indexes for approximate-nearest-neighbor search. At our scale (dozens of applications per user), Postgres does a sequential scan and it's plenty fast (<50ms). Add `CREATE INDEX ON applications USING hnsw (embedding vector_cosine_ops);` if/when query latency becomes noticeable. Probably never for personal use.

- **Embedding doesn't get cleared when a JD is removed.** If you PATCH `job_description=""`, the row keeps its old embedding. The new `_maybe_embed` *does* set it to `None` when called, but it's only called when text fields change — and the check is "did the field appear in the payload," not "is the new value empty." Cosmetic; harmless in practice.

- **Voyage doesn't surface token counts in its response.** Unlike Anthropic, Voyage's SDK doesn't return a `usage` object. The log line for embeddings shows `chars=N` instead of token counts, which is a rough proxy. If Phase 7 introduces an `ai_calls` audit table, we'll want a clean way to estimate embedding cost from character count.

- **Streaming is still nowhere.** Phase 6 didn't need it — embeddings return one shot, and search returns instantly. Phase 7 (resume tailoring) is the right place.

- **No "save bullet variant" feature.** Carried forward from Phase 5; same reasoning.

---

## What Phase 6 means in plain terms

You now have a fourth user-facing AI feature, and your codebase has a **second AI provider** living alongside Claude with the same wrapper-pattern discipline. The Phase 4 substrate stayed untouched; Voyage got its own `embeddings.py` shaped exactly like `claude_client.py`. The pattern from Phase 4 generalizes — a new provider is "another service file plus another env var," not "rebuild the architecture."

The structurally new thing in Phase 6 was **a typed database column powered by an extension** (`vector(1024)` via pgvector). That's the first column in the project that needs (a) a Postgres extension to be enabled, (b) a Python package to be installed, and (c) a manual migration patch because Alembic autogenerate doesn't know about it. The migration is now part of the repo, so future-you on a fresh checkout just runs `alembic upgrade head` after `CREATE EXTENSION vector` and everything works.

The `cosine_distance` operator is the load-bearing piece of the search endpoint. It runs entirely inside Postgres, with no external API call on read. **Embedding is the cost; search is free.** That asymmetry shapes a lot of design choices — embed once and store, then query as much as you want.

You haven't built any new infrastructure besides the second-provider pattern. You've shown the substrate handles a fundamentally different *kind* of AI workload (numeric retrieval vs. token generation) without needing rework.

---

## Commands run during Phase 6

For future reference / re-running on a fresh checkout. Assumes Phase 5 is healthy.

```bash
# === Prerequisites — confirm Phase 5 still works ===
docker compose ps
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"
# Expected: 13 tables including cover_letters, gap_analyses, resume_parses
docker compose exec backend pytest -v
# Expected: 16 passed

# === PHASE 6 PROPER ===

git checkout main
git pull
git checkout -b phase-6-semantic-search

# 1. Get a Voyage AI API key from https://www.voyageai.com/ (200M-token free tier)

# 2. Env var wiring
# (edit root .env: add VOYAGE_API_KEY=pa-...)
# (edit .env.example: add VOYAGE_API_KEY=)
# (edit docker-compose.yml: add VOYAGE_API_KEY: ${VOYAGE_API_KEY} under backend.environment)
# (edit backend/app/config.py: add voyage_api_key: str = "")

# 3. Dependencies
# (edit backend/requirements.txt: add voyageai>=0.3.0 and pgvector>=0.4.0)
docker compose build backend
docker compose up -d

# Verify both libraries import inside the container
docker compose exec backend python -c "import voyageai; print('voyageai ok')"
docker compose exec backend python -c "from pgvector.sqlalchemy import Vector; print('pgvector ok')"
docker compose exec backend python -c "from app.config import settings; print('voyage key set:', bool(settings.voyage_api_key))"

# 4. Enable the pgvector extension in Postgres (one-time)
docker compose exec db psql -U jobtrackr -d jobtrackr -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dx"
# Expected: "vector" row in the extension list
docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT '[1,2,3]'::vector;"
# Expected: "[1,2,3]"

# 5. Service layer
# (create backend/app/services/embeddings.py)
docker compose exec backend python -c "from app.services.embeddings import embed_query, EMBEDDING_DIM; print('ok', EMBEDDING_DIM)"
# Expected: ok 1024

# 6. Schema additions
# (edit backend/app/models.py: add `from pgvector.sqlalchemy import Vector` and 
#    `embedding = Column(Vector(1024), nullable=True)` inside Application)
docker compose exec backend python -c "from app.models import Application; print('column type:', Application.embedding.type)"
# Expected: column type: VECTOR(1024)

# 7. Migration
docker compose exec backend alembic revision --autogenerate -m "add embedding column to applications"
# READ the generated file under backend/alembic/versions/<hash>_add_embedding_column_to_applications.py
# Confirm upgrade() only does op.add_column('applications', ...) for embedding.
# If anything else is being dropped/altered, STOP and investigate.
#
# THEN: manually add `import pgvector.sqlalchemy` near the top of the file,
# right after `import sqlalchemy as sa`. Autogenerate forgets this import.
docker compose exec backend alembic upgrade head
docker compose exec db psql -U jobtrackr -d jobtrackr -c "\d applications"
# Expected: "embedding | vector(1024)" in the column list

# 8. Router for save-time embedding
# (edit backend/app/routers/applications.py: add _maybe_embed helper,
#    call it in create_application and in update_application when text fields change)

# 9. Search router
# (create backend/app/routers/similar_applications.py)
docker compose exec backend python -c "from app.routers.similar_applications import router; print('ok')"

# 10. Wire search router into main.py
# (edit backend/app/main.py: add similar_applications to import + include_router)
docker compose restart backend
docker compose logs --tail=30 backend
# Expected: "Application startup complete." with no tracebacks

# Verify route registered
curl -s http://localhost:8000/openapi.json | python3 -c "import json,sys; d=json.load(sys.stdin); paths=[p for p in d['paths'] if 'similar' in p]; print('\n'.join(paths))"
# Expected: /api/v1/applications/{application_id}/similar

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/applications/1/similar
# Expected: 401 (auth gate working)

# 11. Backfill script for existing rows
mkdir -p backend/app/scripts
touch backend/app/scripts/__init__.py
# (create backend/app/scripts/backfill_embeddings.py)
docker compose exec backend python -m app.scripts.backfill_embeddings
docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*) AS total, COUNT(embedding) AS with_embedding, COUNT(*) FILTER (WHERE job_description IS NOT NULL AND job_description <> '') AS with_jd FROM applications;"
# Expected invariant: with_embedding == with_jd

# 12. Tests
# (create backend/tests/test_similar_applications.py)
docker compose exec backend pytest -v
# Expected: 17 passed

# 13. Frontend
# (edit frontend/src/app/applications/[id]/page.tsx:
#    - Add SimilarApp type
#    - Add SimilarApplicationsCard component
#    - Render it inside the page between CoverLetterCard and BulletRewriterCard)
cd frontend && npm run dev
# Expected: clean compile, "Ready in ..."

# 14. End-to-end browser test (use Chrome, not Safari)
#    - Log in
#    - Create 4-5 applications with different JDs (mix backend / frontend roles to make
#      ranking easy to verify)
#    - Open a backend application → click "Find similar roles"
#      Expected: other backend roles cluster at the top (~70-85%), frontend roles
#      lower (~40-55%)
#    - Open the frontend application → search again
#      Expected: ordering flips
#    - Create one app WITHOUT a JD → confirm the card shows
#      "Add a job description to this application to enable similarity search."
#    - Watch `docker compose logs -f backend` for `voyage embed model=...` lines
#      on every save (none on search)

# 15. Commit
docker compose exec backend pytest -v          # final green check
git add .
git commit -m "Phase 6: semantic search with pgvector + Voyage embeddings"
git push -u origin phase-6-semantic-search
```

---