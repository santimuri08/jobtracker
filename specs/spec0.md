# Phase 0 — Recap

## What we set up on your Mac

You already had Homebrew, Node.js 20, npm, Python 3.12, Git, and VS Code from before. The only thing we installed during Phase 0 was **Docker Desktop** (after cleaning up some leftover symlinks from a previous Docker install that was blocking it).

You also installed a set of VS Code extensions for working with Python, TypeScript, ESLint, Prettier, Tailwind, Prisma, Docker, and Ruff.

## What we created in the project

Your project lives at `~/Desktop/jobtracker/` and is a monorepo with two services side by side. The structure looks like this:

```
jobtracker/
├── .github/workflows/ci.yml      ← GitHub Actions CI pipeline
├── .gitignore                    ← ignores node_modules, .venv, .env, etc.
├── .env.example                  ← template for environment variables (committed)
├── .env                          ← your local copy with real values (not committed)
├── docker-compose.yml            ← orchestrates Postgres + backend together
├── README.md                     ← project overview + quick start
│
├── frontend/                     ← Next.js 15 app
│   ├── src/app/page.tsx          ← default Next.js homepage
│   ├── src/app/health/page.tsx   ← calls the backend health endpoint
│   ├── prisma/schema.prisma      ← Prisma schema (will hold DB models)
│   ├── package.json              ← Next.js, React, Tailwind, Prisma deps
│   └── ...                       ← TypeScript config, Tailwind config, etc.
│
└── backend/                      ← FastAPI service
    ├── app/main.py               ← FastAPI app + /api/v1/health endpoint
    ├── app/config.py             ← Pydantic settings (reads .env)
    ├── tests/test_health.py      ← pytest test for the health endpoint
    ├── pyproject.toml            ← Ruff + mypy + pytest config
    ├── requirements.txt          ← Python dependencies
    ├── Dockerfile                ← builds the backend container image
    ├── .dockerignore             ← keeps .venv etc. out of the image
    └── .venv/                    ← Python 3.12 virtual environment (local only)
```

## What's actually working right now

Your full stack runs locally with Docker. When you run `docker compose up` from the project root:

- A **Postgres 16 container** starts with the **pgvector extension enabled**, exposed on port 5432
- A **FastAPI backend container** starts on port 8000, connected to Postgres
- The backend exposes `GET /api/v1/health` returning `{"status":"ok","service":"jobtrackr-backend"}`
- FastAPI auto-generates API docs at `http://localhost:8000/docs`

Separately, when you run `npm run dev` in `frontend/`:

- The **Next.js dev server** starts on port 3000
- Visiting `http://localhost:3000/health` calls the backend, gets the JSON response, and displays it on the page

That's your **hello-world round trip** — frontend → backend → response — proving the two services can talk to each other through the API contract you'll build out in later phases.

## What's also wired up but not yet exercised

- **Prisma** is installed in the frontend with a placeholder `HealthCheck` model. Schema validates and generates, but no migrations have been run yet — that comes in Phase 1.
- **SQLAlchemy** is installed in the backend but no models exist yet — also Phase 1.
- **GitHub Actions CI** runs on every push: lints both services (ESLint, Ruff), type-checks both (TypeScript, mypy), and runs the backend test suite (pytest). It should be green on `main`.
- **`.env.example`** documents every environment variable the project will need (database URL, Anthropic API key, JWT secret, Resend API key, embedding API key) — the secrets are blank for now and get filled in as features need them.

## What's published to GitHub

Your repo is public/private at `github.com/<your-username>/jobtracker` with the full Phase 0 scaffold pushed to `main`. CI runs on every push, so you can see green checkmarks in the Actions tab.

## What Phase 0 means in plain terms

You haven't built any features yet — no users, no applications, no AI, no resume parsing. What you have is the **skeleton**: two services that can talk to each other, a database with vector search capability ready to use, automated quality checks running in CI, and a one-command local dev environment. Anyone can clone your repo, run `docker compose up` in one terminal and `npm run dev` in another, and have the same setup running in under a minute. That's the entire goal of Phase 0, and you hit it.

## What's next

Phase 1 is the foundation of the actual product: real database schema with users and applications, authentication (Auth.js on the frontend, JWT verification on the backend), and basic CRUD for applications. Once that's in, the AI features in Phase 2 have something to attach to.

Whenever you're ready, say the word and I'll write up the Phase 1 step-by-step in the same style.