# backend/tests/test_auth.py
from fastapi.testclient import TestClient
from jose import jwt
from app.main import app
from app.config import settings

client = TestClient(app)


def make_token(user_id: str = "test-user-123", email: str = "test@example.com"):
    return jwt.encode(
        {"sub": user_id, "email": email},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def test_me_requires_auth():
    response = client.get("/api/v1/me")
    assert response.status_code == 403  # HTTPBearer returns 403 when missing


def test_me_rejects_bad_token():
    response = client.get(
        "/api/v1/me", headers={"Authorization": "Bearer garbage"}
    )
    assert response.status_code == 401


def test_me_accepts_valid_token():
    token = make_token()
    response = client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == "test-user-123"