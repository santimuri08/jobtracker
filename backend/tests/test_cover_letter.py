# backend/tests/test_cover_letter.py
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.cover_letter import run_cover_letter

client = TestClient(app)


def test_post_unauthenticated():
    r = client.post("/api/v1/applications/1/cover-letters", json={})
    assert r.status_code == 401


def test_get_unauthenticated():
    r = client.get("/api/v1/applications/1/cover-letters")
    assert r.status_code == 401


def test_run_cover_letter_returns_mock(mock_claude):
    mock_claude({"content": "Dear Acme team,\n\nI'd love to join you..."})
    out = run_cover_letter(
        resume_parse={"full_name": "Jane Doe", "skills": ["Python"]},
        job_description="We need a Python engineer.",
        company="Acme",
        role="Senior Engineer",
    )
    assert "content" in out
    assert "Acme" in out["content"] or "Dear" in out["content"]


def test_run_cover_letter_rejects_empty_jd():
    with pytest.raises(ValueError):
        run_cover_letter(
            resume_parse={"full_name": "X"},
            job_description="",
            company="Acme",
            role="Eng",
        )