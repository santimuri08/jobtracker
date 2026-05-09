# backend/tests/test_weekly_summary.py
import pytest

from app.services.weekly_summary import run_weekly_summary


def test_run_weekly_summary_returns_mock(mock_claude):
    canned = {
        "subject": "Your week in 5",
        "preheader": "3 new apps, 1 interview",
        "summary_html": "<p>You added 3 applications this week.</p>",
        "suggestions": ["Follow up on Stripe", "Prep for Acme phone screen", "Reach out to a recruiter"],
    }
    mock_claude(canned)
    result = run_weekly_summary({"totals": {"all_applications": 3}}, week_ending="May 9, 2026")
    assert result == canned


def test_run_weekly_summary_rejects_non_dict_stats(mock_claude):
    mock_claude({})
    with pytest.raises(ValueError):
        run_weekly_summary("not a dict", week_ending="May 9, 2026")  # type: ignore[arg-type]