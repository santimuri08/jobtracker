# backend/app/services/cover_letter.py
"""
Cover letter generation service.
Reuses the Phase 4 claude_client.call_claude_json wrapper.
"""
import json
from typing import Any

from app.services.claude_client import call_claude_json


SYSTEM_PROMPT = """You are an expert career coach helping a candidate write a tailored cover letter.

Rules:
- Write 3 to 5 short paragraphs. Total length: 250-400 words.
- Lead with a clear hook tied to the company / role — never "I am writing to apply for..."
- Reference 2-3 concrete achievements from the resume that match the job's needs.
- Match the requested tone if provided; otherwise default to confident but warm.
- Do NOT invent skills, employers, or experiences not present in the resume.
- Do NOT include the date, address blocks, or "Sincerely, [Name]" boilerplate.
- Return strict JSON. No markdown, no code fences, no preamble.
"""

USER_TEMPLATE = """Resume (parsed JSON):
{resume_json}

Job description:
{job_description}

Company: {company}
Role: {role}
Tone: {tone}
Extra instructions from candidate: {extra_instructions}

Return a JSON object with this exact shape:
{{
  "content": "the full cover letter as a single string with \\n\\n between paragraphs"
}}
"""


def run_cover_letter(
    *,
    resume_parse: dict,
    job_description: str,
    company: str,
    role: str,
    tone: str | None = None,
    extra_instructions: str | None = None,
) -> dict[str, Any]:
    if not resume_parse:
        raise ValueError("Resume parse is empty")
    if not job_description or not job_description.strip():
        raise ValueError("Job description is empty")

    user_prompt = USER_TEMPLATE.format(
        resume_json=json.dumps(resume_parse, ensure_ascii=False, indent=2),
        job_description=job_description.strip(),
        company=company or "(not specified)",
        role=role or "(not specified)",
        tone=tone or "(default: confident but warm)",
        extra_instructions=extra_instructions or "(none)",
    )

    return call_claude_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=2048,
    )