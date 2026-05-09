# backend/app/main.py
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.auth import CurrentUser, get_current_user
from app.routers import applications, interview_rounds, contacts, notes, resumes, gap_analyses
app = FastAPI(title="JobTrackr Backend")
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