# backend/app/services/weekly_summary.py
"""
Generates the body of a user's weekly summary email using Claude.

The router collects the raw stats (apps created this week, status changes,
upcoming interviews, etc.) and passes them to `run_weekly_summary` as a
plain dict. Claude turns that into a friendly 3-paragraph summary plus
3 short suggestions.

Same shape as gap_analysis.py / cover_letter.py:
  SYSTEM_PROMPT + USER_TEMPLATE + run_X() that calls call_claude_json.
"""
from __future__ import annotations

import json
from typing import Any

from app.services.claude_client import call_claude_json


SYSTEM_PROMPT = """You are a supportive, concise career coach writing a weekly
job-search recap email for one person. You receive a JSON snapshot of their
job applications from the past 7 days. Your job is to:

1. Acknowledge what they actually did this week (don't invent activity).
2. Surface anything notable (interviews coming up, stalled applications, wins).
3. Offer 2-3 short, specific suggestions for the next 7 days.

Hard rules:
- Output STRICT JSON. No preamble, no markdown, no code fences.
- Use the schema given in the user message exactly.
- Keep `summary_html` under 350 words. Use simple HTML: <p>, <strong>, <ul>, <li>.
- Never invent jobs, companies, dates, or interview rounds. Only use what's in the data.
- If the user did nothing this week, say so kindly and suggest one realistic next action.
- Tone: warm and encouraging, but factual. No emoji. No "Hey there!" boilerplate."""


USER_TEMPLATE = """Here is the user's job-search snapshot for the past 7 days
(week ending {week_ending}):

{stats_json}

Return ONLY a JSON object with this exact shape:

{{
  "subject": "string - the email subject line, max 60 characters",
  "preheader": "string - the small preview text under the subject, max 90 characters",
  "summary_html": "string - the main body of the email as simple HTML",
  "suggestions": ["string", "string", "string"]
}}"""


def run_weekly_summary(stats: dict, week_ending: str) -> dict[str, Any]:
    """
    Build a weekly summary from a stats dict.

    `stats` is whatever the router collected. `week_ending` is a human-readable
    date like "May 9, 2026".
    """
    if not isinstance(stats, dict):
        raise ValueError("stats must be a dict")

    user_prompt = USER_TEMPLATE.format(
        stats_json=json.dumps(stats, ensure_ascii=False, indent=2, default=str),
        week_ending=week_ending,
    )

    return call_claude_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=1500,
    )