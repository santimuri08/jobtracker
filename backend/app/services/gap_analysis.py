# backend/app/services/gap_analysis.py
"""
Gap analysis: compare a parsed resume against a job description and
produce structured feedback.

Pipeline:
    (resume_parse, job_description) -> Claude prompt -> JSON dict
"""
from __future__ import annotations

import json
from typing import Any

from app.services.claude_client import call_claude_json

SYSTEM_PROMPT = """You are an expert technical recruiter doing a gap analysis.

You compare a candidate's parsed resume against a job description and
return STRICTLY a JSON object. No prose, no markdown, no code fences.

Be honest but constructive. Don't invent matches the resume doesn't support.
Don't list a skill as "missing" if a clearly equivalent one is on the resume
(e.g., don't say "PostgreSQL is missing" if the resume lists "Postgres")."""

USER_TEMPLATE = """Compare this resume to this job description and return ONLY
a JSON object with this exact shape:

{{
  "fit_score": <integer 0-100, where 100 is perfect fit>,
  "matched_skills": [<strings: skills the JD asks for that ARE on the resume>],
  "missing_skills": [<strings: skills the JD asks for that are NOT on the resume>],
  "experience_gaps": [
    {{
      "requirement": "<what the JD asks for>",
      "your_experience": "<what the resume shows, or null>",
      "gap": "<short description of the gap>"
    }}
  ],
  "recommendations": [<2-4 short, actionable strings>],
  "summary": "<2-3 sentence overall assessment>"
}}

Rules:
- fit_score must be an integer between 0 and 100.
- Empty arrays are fine when nothing applies.
- Return ONLY the JSON. No preamble, no markdown.

=== RESUME (parsed) ===
{resume_json}

=== JOB DESCRIPTION ===
{job_description}
"""


def run_gap_analysis(
    resume_parse: dict[str, Any],
    job_description: str,
) -> dict[str, Any]:
    """
    Run gap analysis. Returns the parsed JSON dict from Claude.

    Raises ValueError if Claude returns malformed JSON or inputs are empty.
    Raises RuntimeError if ANTHROPIC_API_KEY isn't set.
    """
    if not job_description or not job_description.strip():
        raise ValueError("Job description is empty")
    if not resume_parse:
        raise ValueError("Resume parse is empty")

    user_prompt = USER_TEMPLATE.format(
        resume_json=json.dumps(resume_parse, ensure_ascii=False, indent=2),
        job_description=job_description.strip(),
    )

    return call_claude_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=2048,
    )