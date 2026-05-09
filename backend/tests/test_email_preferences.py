# backend/tests/test_email_preferences.py
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_unauthenticated():
    r = client.get("/api/v1/email-preferences")
    assert r.status_code == 401


def test_patch_unauthenticated():
    r = client.patch("/api/v1/email-preferences", json={"frequency": "off"})
    assert r.status_code == 401


def test_trigger_unauthenticated():
    r = client.post("/api/v1/email-preferences/test")
    assert r.status_code == 401


def test_unsubscribe_with_bad_token_404():
    r = client.post("/api/v1/unsubscribe", json={"token": "not-a-real-token"})
    assert r.status_code == 404