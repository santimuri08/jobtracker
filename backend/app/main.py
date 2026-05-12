# backend/app/main.py
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import CurrentUser, get_current_user
from app.routers import (
    applications,
    interview_rounds,
    contacts,
    notes,
    resumes,
    gap_analyses,
    cover_letters,
    bullet_rewrites,
    chats,
    email_preferences,
    similar_applications,
    job_search,
    reminders,
    agent,
)
from app.scheduler import start_scheduler, stop_scheduler


# ---------- logging setup ----------
#
# By default the root logger has no handlers and is at WARNING level,
# which means `logger.info(...)` and `logger.exception(...)` calls from
# our routers and services go nowhere. Configure once at startup so
# everything written through the standard `logging` API ends up in
# `docker compose logs backend`.
def _configure_logging() -> None:
    root = logging.getLogger()
    # Only configure once — avoid duplicate handlers if uvicorn reloads.
    if any(getattr(h, "_jobagent_handler", False) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    handler._jobagent_handler = True  # marker so we don't double-add
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # Quiet down the noisiest third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)


_configure_logging()


# ---------- app lifespan ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="JobTrackr Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "service": "jobtrackr-backend"}


@app.get("/api/v1/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {"user_id": user.id, "email": user.email}


app.include_router(applications.router)
app.include_router(interview_rounds.router)
app.include_router(contacts.router)
app.include_router(notes.router)
app.include_router(resumes.router)
app.include_router(gap_analyses.router)
app.include_router(cover_letters.router)
app.include_router(bullet_rewrites.router)
app.include_router(email_preferences.router)
app.include_router(similar_applications.router)
app.include_router(job_search.router)
app.include_router(reminders.router)
app.include_router(agent.router)
app.include_router(chats.router)