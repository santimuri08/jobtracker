# backend/app/routers/job_search.py
"""
Job search endpoint.

GET /api/v1/jobs/search

Thin wrapper around the active JobProvider. Returns a JSON envelope:
  { "provider": "jsearch", "count": N, "results": [...] }

Each result is the JobListing.to_public_dict() shape (provider field
included, raw provider payload stripped). No DB writes.

Auth is required — same JWT dependency every other endpoint uses —
even though the underlying API call isn't user-specific. This lets
us add per-user rate limits in a later phase without breaking the
contract.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.services.job_search import get_provider, JobListing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


# ---------- response shape ----------

class JobSearchResult(BaseModel):
    """Serializable JobListing — matches JobListing.to_public_dict()."""
    external_id: str
    provider: str
    title: str
    company: str
    location: Optional[str] = None
    description: Optional[str] = None
    apply_url: Optional[str] = None
    posted_at: Optional[str] = None
    employment_type: Optional[str] = None
    is_remote: Optional[bool] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[str] = None


class JobSearchResponse(BaseModel):
    provider: str
    count: int
    results: list[JobSearchResult]


# ---------- endpoint ----------

@router.get("/search", response_model=JobSearchResponse)
def search_jobs(
    q: str = Query(..., min_length=2, max_length=200, description="Keyword/title query"),
    location: Optional[str] = Query(None, max_length=120),
    remote: Optional[bool] = Query(None, description="True=remote only, False=onsite only, omit=either"),
    employment_type: Optional[str] = Query(
        None,
        pattern="^(fulltime|parttime|contract|internship|temporary)$",
    ),
    country: Optional[str] = Query(None, pattern="^[a-zA-Z]{2}$"),
    limit: int = Query(10, ge=1, le=20),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Search live job listings via the configured provider.

    `country` defaults to settings.job_search_default_country if omitted.
    """
    provider = get_provider()
    country_code = (country or settings.job_search_default_country or "us").lower()

    logger.info(
        "search_jobs user=%s provider=%s q=%r location=%r remote=%s emp=%s country=%s limit=%s",
        user.id, provider.name, q, location, remote, employment_type, country_code, limit,
    )

    try:
        listings = provider.search(
            query=q,
            location=location,
            remote=remote,
            employment_type=employment_type,
            country=country_code,
            limit=limit,
        )
    except RuntimeError as e:
        # Provider raised a controlled error (auth fail, timeout, rate limit, etc.)
        logger.warning("search_jobs provider error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        # Unexpected — log full trace, return generic 500
        logger.exception("search_jobs unexpected error")
        raise HTTPException(status_code=500, detail=f"Job search failed: {type(e).__name__}")

    return JobSearchResponse(
        provider=provider.name,
        count=len(listings),
        results=[_to_result(j) for j in listings],
    )


def _to_result(j: JobListing) -> JobSearchResult:
    return JobSearchResult(**j.to_public_dict())