# backend/app/main.py
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
    email_preferences,
    agent,
)
from app.scheduler import start_scheduler, stop_scheduler


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
app.include_router(agent.router)