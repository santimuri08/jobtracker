# backend/tests/test_bullet_rewriter.py
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.bullet_rewriter import run_bullet_rewrite

client = TestClient(app)


def test_post_unauthenticated():
    r = client.post("/api/v1/bullet-rewrites", json={"bullet": "did things"})
    assert r.status_code == 401


def test_run_bullet_rewrite_returns_three_variants(mock_claude):
    mock_claude({
        "variants": [
            {"style": "impact", "text": "Drove X by 30%", "rationale": "added metric"},
            {"style": "concise", "text": "Drove X.", "rationale": "tightened"},
            {"style": "ats", "text": "Led X using Python.", "rationale": "added keyword"},
        ]
    })
    out = run_bullet_rewrite(bullet="I did things", job_description="Python role")
    assert len(out["variants"]) == 3
    styles = [v["style"] for v in out["variants"]]
    assert set(styles) == {"impact", "concise", "ats"}


def test_run_bullet_rewrite_rejects_empty():
    with pytest.raises(ValueError):
        run_bullet_rewrite(bullet="", job_description=None)