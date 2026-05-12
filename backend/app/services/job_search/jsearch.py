# backend/app/services/job_search/jsearch.py
"""
JSearch provider — aggregator API on RapidAPI that pulls from Indeed,
LinkedIn, Glassdoor, ZipRecruiter, etc.

Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
Free tier: 200 requests/month. Plenty for dev + light prod.

JSearch's /search returns a `data` array with one job per element.
We map the relevant fields into JobListing and drop the rest.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import requests

from app.services.job_search.base import JobListing, JobProvider

logger = logging.getLogger(__name__)

JSEARCH_HOST = "jsearch.p.rapidapi.com"
JSEARCH_URL = f"https://{JSEARCH_HOST}/search"
DEFAULT_TIMEOUT = 15.0  # seconds


class JSearchProvider(JobProvider):
    name = "jsearch"

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("JSearchProvider requires a non-empty api_key")
        self._api_key = api_key

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
        # JSearch combines query + location into a single `query` string.
        # Their API guide explicitly recommends this.
        full_query = query.strip()
        if location:
            full_query = f"{full_query} in {location.strip()}"

        params: dict[str, Any] = {
            "query": full_query,
            "page": "1",
            "num_pages": "1",
            "country": country.lower(),
        }
        if remote is True:
            params["work_from_home"] = "true"
        if employment_type:
            # JSearch expects upper-case comma-separated values
            params["employment_types"] = employment_type.upper()

        headers = {
            "X-RapidAPI-Key": self._api_key,
            "X-RapidAPI-Host": JSEARCH_HOST,
        }

        logger.info(
            "jsearch search query=%r country=%s remote=%s emp_type=%s",
            full_query, country, remote, employment_type,
        )

        try:
            resp = requests.get(
                JSEARCH_URL,
                params=params,
                headers=headers,
                timeout=DEFAULT_TIMEOUT,
            )
        except requests.Timeout:
            logger.warning("jsearch timeout after %ss", DEFAULT_TIMEOUT)
            raise RuntimeError("Job search timed out. Try again in a moment.")
        except requests.RequestException as e:
            logger.exception("jsearch network error: %s", e)
            raise RuntimeError(f"Job search network error: {e}")

        if resp.status_code == 401:
            raise RuntimeError("JSearch auth failed — check RAPIDAPI_KEY.")
        if resp.status_code == 429:
            raise RuntimeError("JSearch rate limit hit. Wait, then retry.")
        if not resp.ok:
            logger.warning("jsearch http %s body=%s", resp.status_code, resp.text[:300])
            raise RuntimeError(f"JSearch returned HTTP {resp.status_code}")

        payload = resp.json()
        raw_jobs = payload.get("data") or []
        logger.info("jsearch returned %d jobs", len(raw_jobs))

        listings: list[JobListing] = []
        for j in raw_jobs[:limit]:
            try:
                listings.append(_map(j))
            except Exception as e:
                # One malformed row shouldn't kill the whole response.
                logger.warning("jsearch map failed for one row: %s", e)
                continue

        return listings


def _map(j: dict[str, Any]) -> JobListing:
    """Map a JSearch row to a JobListing. Be defensive — the schema drifts."""
    return JobListing(
        external_id=str(j.get("job_id") or ""),
        provider="jsearch",
        title=j.get("job_title") or "Untitled role",
        company=j.get("employer_name") or "Unknown company",
        location=_location_str(j),
        description=j.get("job_description"),
        apply_url=j.get("job_apply_link") or j.get("job_google_link"),
        posted_at=j.get("job_posted_at_datetime_utc"),
        employment_type=j.get("job_employment_type"),
        is_remote=j.get("job_is_remote"),
        salary_min=_to_float(j.get("job_min_salary")),
        salary_max=_to_float(j.get("job_max_salary")),
        salary_currency=j.get("job_salary_currency"),
        salary_period=j.get("job_salary_period"),
        raw=j,
    )


def _location_str(j: dict[str, Any]) -> Optional[str]:
    """Build a human-readable location from JSearch's separate city/state/country fields."""
    parts = [j.get("job_city"), j.get("job_state"), j.get("job_country")]
    parts = [p for p in parts if p]
    return ", ".join(parts) if parts else None


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None