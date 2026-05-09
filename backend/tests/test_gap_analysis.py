# backend/tests/test_gap_analysis.py
"""Smoke tests for gap analysis. Real DB-backed tests need a user fixture (later)."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_post_gap_analysis_unauthenticated():
    r = client.post("/api/v1/applications/1/gap-analysis")
    assert r.status_code == 401


def test_get_gap_analysis_unauthenticated():
    r = client.get("/api/v1/applications/1/gap-analysis")
    assert r.status_code == 401


def test_service_layer_uses_mocked_claude(mock_claude):
    """Prove the mock fixture works end-to-end at the service layer."""
    from app.services.gap_analysis import run_gap_analysis

    mock_claude({
        "fit_score": 75,
        "matched_skills": ["Python", "FastAPI"],
        "missing_skills": ["Kubernetes"],
        "experience_gaps": [],
        "recommendations": ["Add a Kubernetes project"],
        "summary": "Strong backend fit, weak on infra.",
    })

    out = run_gap_analysis(
        resume_parse={"skills": ["Python", "FastAPI"]},
        job_description="We need Python, FastAPI, and Kubernetes.",
    )
    assert out["fit_score"] == 75
    assert "Kubernetes" in out["missing_skills"]