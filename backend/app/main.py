# backend/app/main.py
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.auth import CurrentUser, get_current_user

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


@app.get("/api/v1/protected/ping")
def protected_ping(user: CurrentUser = Depends(get_current_user)):
    return {"message": f"Hello, user {user.id}", "user_id": user.id}