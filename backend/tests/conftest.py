# backend/tests/conftest.py
"""Shared pytest fixtures."""
import pytest


@pytest.fixture
def mock_claude(monkeypatch):
    """
    Patch app.services.claude_client.call_claude_json to return a canned dict.

    Usage in a test:
        def test_something(mock_claude):
            mock_claude({"fit_score": 80, ...})
            # now any code that calls call_claude_json gets that dict back
    """
    holder = {"response": {}}

    def _fake_call(*, system, user, max_tokens=2048, model=None):
        return holder["response"]

    def _set(response: dict):
        holder["response"] = response
        # Patch every place that imported the function
        import app.services.claude_client as client_mod
        import app.services.gap_analysis as gap_mod
        monkeypatch.setattr(client_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(gap_mod, "call_claude_json", _fake_call)

    return _set