# backend/app/services/job_search/mock.py
"""
Mock provider. Returns plausible-looking results without calling any
external API. Used when:
  - JOB_SEARCH_PROVIDER=mock (explicit dev setting)
  - The configured provider's API key is missing (graceful fallback)

Results are deterministic per query so tests can assert on them.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from app.services.job_search.base import JobListing, JobProvider

logger = logging.getLogger(__name__)


_SAMPLE_COMPANIES = [
    "Stripe", "Figma", "Datadog", "Linear", "Vercel", "Notion",
    "Anthropic", "Cloudflare", "Render", "PlanetScale",
]


class MockProvider(JobProvider):
    name = "mock"

    def search(
        self,
        *,
        query: str,
        location: Optional[str] = None,
        remote: Optional[bool] = None,
        employment_type: Optional[str] = None,
        country: str = "us",
        limit: int = 10,
    ) -> list[JobListing]:
        logger.info(
            "mock search query=%r location=%s remote=%s",
            query, location, remote,
        )

        # Deterministic per-query — same query always returns same mocks.
        seed = int(hashlib.sha256(query.encode()).hexdigest(), 16)
        listings: list[JobListing] = []
        n = min(limit, 5)

        for i in range(n):
            company = _SAMPLE_COMPANIES[(seed + i) % len(_SAMPLE_COMPANIES)]
            external_id = f"mock-{seed % 100000}-{i}"
            listings.append(JobListing(
                external_id=external_id,
                provider="mock",
                title=_title_from_query(query, i),
                company=company,
                location=location or ("Remote" if remote else "San Francisco, CA, US"),
                description=(
                    f"This is a mock job posting for {company}. "
                    f"Configure JOB_SEARCH_PROVIDER and a real API key "
                    f"to see live listings."
                ),
                apply_url=f"https://example.com/jobs/{external_id}",
                posted_at=None,
                employment_type="FULLTIME",
                is_remote=bool(remote),
                salary_min=120000.0 + (i * 10000),
                salary_max=180000.0 + (i * 10000),
                salary_currency="USD",
                salary_period="yearly",
                raw={"mock": True},
            ))

        return listings


def _title_from_query(query: str, i: int) -> str:
    """Build a plausible title variant from the query keywords."""
    base = query.strip().title() or "Software Engineer"
    suffixes = ["", " (Senior)", " — Remote", " II", " (Hybrid)"]
    return f"{base}{suffixes[i % len(suffixes)]}"