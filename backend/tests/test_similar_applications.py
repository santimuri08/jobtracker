# backend/tests/test_similar_applications.py
"""Smoke test for the similar-applications endpoint."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_similar_unauthenticated():
    r = client.get("/api/v1/applications/1/similar")
    assert r.status_code == 401