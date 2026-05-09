# backend/app/services/resume_parser.py
import json
import pdfplumber
from anthropic import Anthropic
from app.config import settings


PARSE_PROMPT = """You are a resume parser. Extract the structured information from the resume text below and return ONLY a valid JSON object with this exact shape:

{
  "full_name": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "summary": "string or null (the professional summary/objective if present)",
  "skills": ["array of skills as strings"],
  "work_experience": [
    {
      "company": "string",
      "title": "string",
      "start_date": "YYYY-MM or YYYY format",
      "end_date": "YYYY-MM, YYYY, or 'Present'",
      "location": "string or null",
      "bullets": ["array of bullet point strings"]
    }
  ],
  "education": [
    {
      "school": "string",
      "degree": "string (e.g. 'Bachelor of Science')",
      "field": "string (e.g. 'Computer Science')",
      "start_date": "YYYY or null",
      "end_date": "YYYY or null"
    }
  ]
}

Rules:
- Return ONLY the JSON object, no preamble, no markdown, no code fences.
- Use null for any field you can't find. Never invent data.
- Empty arrays [] are fine for skills/work_experience/education if the resume has none.

Resume text:
---
{resume_text}
---"""


def extract_text_from_pdf(file_path: str) -> str:
    """Pull all text out of a PDF using pdfplumber."""
    parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                parts.append(text)
    return "\n\n".join(parts)


def parse_resume_with_claude(resume_text: str) -> dict:
    """Send resume text to Claude and get back structured JSON."""
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=settings.anthropic_api_key)
    
    prompt = PARSE_PROMPT.replace("{resume_text}", resume_text)
    
    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    
    raw = message.content[0].text.strip()
    # Strip code fences if Claude added them despite instructions
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    
    return json.loads(raw)


def parse_pdf(file_path: str) -> tuple[dict, str]:
    """Full pipeline: PDF path → (parsed dict, raw text)."""
    raw_text = extract_text_from_pdf(file_path)
    if not raw_text.strip():
        raise ValueError("Could not extract any text from the PDF")
    parsed = parse_resume_with_claude(raw_text)
    return parsed, raw_text