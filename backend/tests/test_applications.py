# backend/tests/test_applications.py
"""
Lightweight smoke tests for the applications router.
Real CRUD tests with a seeded user/test DB will be added in a later phase
when we set up a proper test database fixture.
"""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_list_unauthenticated():
    """Hitting the applications endpoint without a token should be rejected."""
    r = client.get("/api/v1/applications")
    assert r.status_code == 401


def test_create_unauthenticated():
    r = client.post("/api/v1/applications", json={"company": "Acme", "role": "Engineer"})
    assert r.status_code == 401