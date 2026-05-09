# backend/app/services/bullet_rewriter.py
"""
Bullet rewriter service.
Returns three rewrites of a single resume bullet, each in a different style.
"""
from typing import Any

from app.services.claude_client import call_claude_json


SYSTEM_PROMPT = """You are a resume coach. Rewrite a single resume bullet in three different styles.

Styles:
- "impact": lead with a strong action verb, quantify outcomes when plausible (do not invent numbers — use ranges like "~20%" only if directionally implied by the original; otherwise focus on scope and result), 1 sentence.
- "concise": tightest possible version, max 18 words, no fluff, still verb-led.
- "ats": include the most relevant keyword(s) from the job description verbatim where natural; do NOT keyword-stuff; 1-2 sentences.

Hard rules:
- Do NOT invent technologies, employers, dates, team sizes, or metrics that aren't supported by the original.
- Each variant must be a faithful rewrite of the SAME accomplishment, not a different one.
- Return strict JSON only. No markdown, no fences, no preamble.
"""

USER_TEMPLATE = """Original bullet:
{bullet}

Job description (use for ATS keyword selection; may be empty):
{job_description}

Return a JSON object with this exact shape:
{{
  "variants": [
    {{
      "style": "impact",
      "text": "rewritten bullet",
      "rationale": "1 short sentence on what changed"
    }},
    {{
      "style": "concise",
      "text": "rewritten bullet",
      "rationale": "1 short sentence"
    }},
    {{
      "style": "ats",
      "text": "rewritten bullet",
      "rationale": "1 short sentence noting which JD keywords were used"
    }}
  ]
}}
"""


def run_bullet_rewrite(
    *,
    bullet: str,
    job_description: str | None = None,
) -> dict[str, Any]:
    if not bullet or not bullet.strip():
        raise ValueError("Bullet is empty")

    user_prompt = USER_TEMPLATE.format(
        bullet=bullet.strip(),
        job_description=(job_description or "").strip() or "(no job description provided — focus on impact and concision)",
    )

    return call_claude_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=1024,
    )