# Phase 1 — Authentication & User Model (Recap)

## What Phase 1 set out to do

Before any feature work — applications, AI parsing, anything — the app needs identity. Every row in every future table will carry a `user_id`. Every endpoint will scope its data to one user. So Phase 1 builds the auth layer that makes that possible.

The "done when" criteria were: a user can sign up, log in, hit a protected backend endpoint, and we've confirmed that two different users get two different identities (data isolation). All four are now true.

---

## The mental model

There are two services and they trust each other through a shared secret.

**The frontend (Next.js + Auth.js)** owns the user-facing flows. It runs the signup form, the login form, the OAuth dance with GitHub, and stores the user record in Postgres via Prisma. When a user logs in successfully, Auth.js creates a session and — this is the key part — also mints a JSON Web Token (JWT) signed with a shared secret called `JWT_SECRET`.

**The backend (FastAPI)** does not run its own login flow. It doesn't have signup pages or password fields. Instead, it acts like a bouncer: every protected endpoint reads the `Authorization: Bearer <token>` header, verifies the token's signature using the same `JWT_SECRET`, and extracts the user's ID from the token's `sub` (subject) claim. If the signature is invalid or the token is missing, the request is rejected.

The shared secret is what makes this work. Both services have `JWT_SECRET=84uD7BGl...` in their environment. The frontend signs with it, the backend verifies with it. If the secrets don't match, every request fails — which is by design.

The database is shared too. Both services point to the same Postgres instance. The frontend writes user records there (via Prisma) during signup. The backend can read them there (via SQLAlchemy, in later phases) when it needs to.

---

## What's running right now

Three things spin up your full stack:

1. `docker compose up` from the project root brings up Postgres on port 5432 and the FastAPI backend on port 8000.
2. `npm run dev` from the `frontend/` directory brings up Next.js on port 3000.
3. The browser at `http://localhost:3000` talks to both: pages render from Next.js, and the dashboard fetches data from `http://localhost:8000`.

The full sign-up round trip looks like this:

User fills the signup form at `/signup` → frontend POSTs to `/api/signup` → that route hashes the password with bcrypt and creates a row in the `users` table → frontend then calls Auth.js's `signIn("credentials", ...)` → Auth.js verifies the password and creates a session → Auth.js's session callback mints a JWT signed with `JWT_SECRET` and attaches it to `session.backendToken` → the user lands on `/dashboard` → the dashboard fetches `http://localhost:8000/api/v1/me` with the JWT in the `Authorization` header → FastAPI's `get_current_user` dependency verifies the signature, extracts the user ID, and returns it as JSON → the dashboard displays it.

That whole chain works end-to-end now.

---

## File-by-file walkthrough

### Frontend

**`frontend/.env`**
Holds the database URL, JWT secret, Auth.js secret, and (eventually) GitHub OAuth credentials. Auth.js reads `JWT_SECRET` and `AUTH_SECRET` from here. Prisma reads `DATABASE_URL` from here at runtime. This file is gitignored — the secrets stay local. The same values also live in the root `.env` so the backend can read them.

**`frontend/prisma.config.ts`**
Prisma 7 moved the database URL out of `schema.prisma` and into this config file. It loads `dotenv/config` at the top so environment variables are available, then exports the schema path, the migrations directory, and the datasource URL. The Prisma CLI (`migrate`, `generate`, `studio`) reads this file to know where the database is.

**`frontend/prisma/schema.prisma`**
Defines four models that mirror the Auth.js standard schema: `User`, `Account`, `Session`, and `VerificationToken`. The `User` table has `id` (a CUID), `email` (unique), optional `name`, and `passwordHash` (nullable so OAuth users without passwords can exist). `Account` stores OAuth provider links (one row per GitHub link, etc.). `Session` and `VerificationToken` exist for completeness even though we use JWT-based sessions instead of database sessions. The `@@map` directives rename the tables to lowercase plural (`users`, `accounts`) to match SQL conventions.

**`frontend/prisma/migrations/`**
The output of `prisma migrate dev`. Each subfolder contains a `migration.sql` file that creates the tables. These get committed and applied in order on any new environment.

**`frontend/src/lib/prisma.ts`**
A singleton Prisma Client. Prisma 7 requires a "driver adapter" — for Postgres that means `@prisma/adapter-pg`. The file constructs a `PrismaPg` adapter using `DATABASE_URL`, passes it to a new `PrismaClient`, and stores the result on `globalThis` to prevent Next.js's hot reload from spawning a new database connection on every code change. Every other file that needs the database imports `prisma` from here instead of constructing its own.

**`frontend/src/auth.ts`**
The Auth.js configuration. Three things happen:
- It registers two providers: `Credentials` (email + password) and `GitHub` (OAuth).
- The `Credentials.authorize` function looks up the user by email, compares the supplied password against `passwordHash` using bcrypt, and returns the user object on success.
- The `callbacks` block does two things: stores the user's ID in the JWT under `token.userId`, and during session creation mints a separate JWT — signed with `JWT_SECRET` and using HS256 — that the backend can verify. This token gets attached to the session as `session.backendToken` so the dashboard can read it from `useSession()`.

The exports `handlers`, `signIn`, `signOut`, and `auth` are what the rest of the app imports.

**`frontend/src/types/next-auth.d.ts`**
TypeScript module augmentation. Auth.js's default `Session` type doesn't know about `backendToken` or `user.id`, so this file extends the type. Without it, TypeScript would error on `session.backendToken` and `session.user.id` everywhere.

**`frontend/src/app/api/auth/[...nextauth]/route.ts`**
A two-line file: `import { handlers } from "@/auth"` then `export const { GET, POST } = handlers`. Auth.js v5 returns one `handlers` object containing both methods, so we destructure them and re-export them as the named exports Next.js's route handler convention requires. This single dynamic route handles all OAuth callbacks (`/api/auth/callback/github`), session reads (`/api/auth/session`), CSRF tokens, and credential POSTs.

**`frontend/src/app/api/signup/route.ts`**
Auth.js v5 doesn't include built-in user creation for the Credentials provider, so this is a custom POST endpoint. It validates that email and password were supplied, that the password is at least 8 characters, that no user with that email already exists, hashes the password with bcrypt (10 rounds), creates the row, and returns the new user (without the hash). On any DB error it returns 500.

**`frontend/src/app/signup/page.tsx`**
A client component (`"use client"`) with a form. On submit it POSTs to `/api/signup` and, if that succeeds, calls `signIn("credentials", ...)` to log the user in immediately (so they don't have to type their password again). Then redirects to `/dashboard`. Errors are displayed inline.

**`frontend/src/app/login/page.tsx`**
Similar to signup but skips the API call — it just calls `signIn("credentials", ...)` directly. Also has a "Continue with GitHub" button that calls `signIn("github", ...)` for the OAuth flow.

**`frontend/src/components/SessionProvider.tsx`**
A thin client wrapper around Auth.js's `<SessionProvider>`. It exists because providers can't be used directly in server components, so we wrap it in a client component and use that in the root layout instead.

**`frontend/src/app/layout.tsx`**
The root layout. Wraps every page in `<AuthSessionProvider>` so that any client component can call `useSession()` and get the current user.

**`frontend/src/app/dashboard/page.tsx`**
The first protected page. Reads the session with `useSession()`. If the session is loading, it shows a spinner. If the user isn't authenticated, it redirects to `/login`. Otherwise it grabs `session.backendToken`, calls `http://localhost:8000/api/v1/me` with that token in the `Authorization` header, and displays the resulting JSON. The fact that the JSON shows the user's correct ID is the proof that the JWT round trip works.

### Backend

**`backend/app/config.py`**
Pydantic settings. Defines a `Settings` class that reads environment variables: `DATABASE_URL`, `JWT_SECRET` (required — no default), `JWT_ALGORITHM` (default HS256), `JWT_EXPIRES_IN` (default 24 hours). Pydantic validates these on startup; if `JWT_SECRET` is missing, the backend refuses to start. The `settings` instance at the bottom is what other files import.

**`backend/app/auth.py`**
The verification middleware. It defines a `CurrentUser` model (a Pydantic class with `id` and `email`) and a `get_current_user` dependency function. The function uses FastAPI's `HTTPBearer` to pull the token out of the `Authorization` header, then `jose.jwt.decode` to verify the signature with `JWT_SECRET`. On success it returns a `CurrentUser` object built from the token's `sub` and `email` claims. On failure it raises `HTTPException(401)`.

**`backend/app/main.py`**
The FastAPI app. Three routes are defined: `/api/v1/health` (public, returns ok), `/api/v1/me` (protected, returns the current user), and `/api/v1/protected/ping` (also protected, returns a greeting). The two protected routes use `Depends(get_current_user)` — that's how the dependency injection works. CORS is configured to allow requests from `http://localhost:3000` so the frontend can call the backend in development.

**`backend/tests/test_auth.py`**
Three pytest tests. `test_me_requires_auth` calls `/api/v1/me` with no header and expects 401. `test_me_rejects_bad_token` sends a garbage token and expects 401. `test_me_accepts_valid_token` builds a real JWT using the same secret the backend uses, sends it, and expects 200 with the correct user ID. Together they prove the gate works in both directions: nothing fake gets through, real tokens are accepted.

**`backend/requirements.txt`**
Now includes `python-jose[cryptography]` (JWT verification), `passlib[bcrypt]` (kept for any future backend-side hashing), `sqlalchemy` and `alembic` (for Phase 2 models and migrations), and the Postgres drivers `psycopg2-binary` and `asyncpg`.

### Infrastructure

**`docker-compose.yml`**
Defines two services. The `db` service runs `pgvector/pgvector:pg16` (Postgres 16 with pgvector extension preloaded for later semantic search), exposes port 5432, persists data in a named volume, and has a healthcheck so the backend waits for it before starting. The `backend` service builds from `./backend`, depends on the `db` healthcheck, exposes port 8000, and reads four environment variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRES_IN`. The `${JWT_SECRET}` syntax pulls the value from the project root's `.env` file at compose time.

**Root `.env`**
Holds the same `JWT_SECRET` and `AUTH_SECRET` as `frontend/.env`, plus database URL, OAuth placeholders, and slots for later phase secrets (Anthropic API key, Resend, embedding API). This file is gitignored. `.env.example` is the committed template that documents the required keys without values.

---

## How a request actually flows

When you load `/dashboard` in the browser, here's the literal sequence:

1. Browser GETs `localhost:3000/dashboard`.
2. Next.js renders the page server-side initially. The `useSession()` call hasn't run yet (it runs on the client).
3. Browser receives HTML, hydrates React, and the dashboard component mounts.
4. `useSession()` calls `/api/auth/session` internally to get the current session.
5. Auth.js (running in `[...nextauth]/route.ts`) reads the cookie, decrypts the session, runs the session callback in `auth.ts` which mints `session.backendToken`, and returns the full session as JSON.
6. The dashboard's `useEffect` sees `session.backendToken` and fetches `http://localhost:8000/api/v1/me` with that token as `Authorization: Bearer ...`.
7. FastAPI receives the request. The `Depends(get_current_user)` runs before the route handler. It pulls the token, verifies the HS256 signature against `JWT_SECRET` (which both services share), extracts `sub` (the user ID), and constructs a `CurrentUser`.
8. The route handler runs with `user` already populated and returns `{"user_id": user.id, "email": user.email}`.
9. CORS middleware adds `Access-Control-Allow-Origin: http://localhost:3000` to the response so the browser doesn't block it.
10. The dashboard receives the JSON and renders it in the `<pre>` block.

If any link in that chain breaks — wrong secret, expired token, missing header, CORS misconfig — you'll see exactly where because the symptoms are different (401 vs. CORS error vs. "no session").

---

## Why we proved data isolation

When you signed up Alice and saw her user ID, then signed up Bob and saw a different user ID, that's not just two separate logins — it's the foundation of every future feature. In Phase 2, the `applications` table will have a `user_id` foreign key. Every endpoint that returns applications will be `SELECT * FROM applications WHERE user_id = current_user.id`. Because the auth layer guarantees that `current_user.id` is exactly the user who owns the JWT, isolation is automatic. Bob can't ever see Alice's applications because Bob's JWT decodes to Bob's ID, and the query filter cuts everything else out.

This is the whole reason auth came before features.

---

## What's wired but dormant

A few things are installed and configured but not yet used in active code paths:

- **GitHub OAuth.** The Auth.js config registers the GitHub provider, but the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` env vars are blank. As soon as you fill them in (after registering an OAuth app on GitHub), the "Continue with GitHub" button on the login page works.
- **SQLAlchemy and Alembic.** Installed in the backend but no models or migrations exist yet. Phase 2 introduces them.
- **The `Account`, `Session`, and `VerificationToken` Prisma models.** Created by the schema but unused right now because we use JWT-based sessions instead of database sessions. They'll be used if we ever add OAuth or email verification flows.
- **The pgvector extension.** Enabled in the database container but not used yet. Phase 2 or later (semantic search over job descriptions, resumes, etc.) will use it.

---

## What Phase 1 means in plain terms

The skeleton from Phase 0 now has identity. Two services agree on who you are because they share one secret. Every protected route can ask "who is this?" and get a reliable answer that the user can't forge. Two users are properly separated. Everything from here — applications, AI features, email integrations — gets built on top of a trustworthy `user_id`.

You haven't built the product yet. You've built the floor that the product stands on.

---

## What's next

Phase 2 is the first real feature surface: the `applications` table, CRUD endpoints for it, and the start of the resume parsing pipeline. Because every row in `applications` will reference `user_id`, and every endpoint will use the `get_current_user` dependency you already have, isolation is free. You just write the queries with `WHERE user_id = current_user.id` and the data scoping is handled.