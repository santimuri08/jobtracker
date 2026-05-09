# backend/tests/conftest.py
import pytest


@pytest.fixture
def mock_claude(monkeypatch):
    """
    Patch call_claude_json everywhere it's been imported.
    Each new AI service module needs one extra patch line below.
    """
    holder = {"response": {}}

    def _fake_call(*, system, user, max_tokens=2048, model=None):
        return holder["response"]

    def _set(response: dict):
        holder["response"] = response
        import app.services.claude_client as client_mod
        import app.services.gap_analysis as gap_mod
        import app.services.cover_letter as cover_mod
        import app.services.bullet_rewriter as bullet_mod
        import app.services.weekly_summary as weekly_mod
        monkeypatch.setattr(client_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(gap_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(cover_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(bullet_mod, "call_claude_json", _fake_call)
        monkeypatch.setattr(weekly_mod, "call_claude_json", _fake_call)

    return _set