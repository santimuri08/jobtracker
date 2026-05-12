# backend/app/services/job_search/base.py
"""
Provider-agnostic job search interface.

Every provider (JSearch, LinkedIn, Indeed direct, mock) implements
`JobProvider.search(...)` and returns a list of `JobListing` instances.
The agent and REST endpoint only ever see `JobListing` — they don't
know or care which provider produced them.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass(frozen=True)
class JobListing:
    """
    Provider-neutral job posting shape.

    `external_id` is the provider's own ID (e.g. JSearch's job_id) and is
    NOT a database PK. The agent uses it as a handle when the user says
    "save the third one" — we send the ID back to the search/save tool
    and the provider knows how to find it again (or we just rehydrate
    from the cached results in conversation context).

    `raw` carries the provider's original payload for debugging. We
    don't expose it through the REST endpoint or the chat tool.
    """
    external_id: str
    provider: str
    title: str
    company: str
    location: Optional[str] = None
    description: Optional[str] = None
    apply_url: Optional[str] = None
    posted_at: Optional[str] = None        # ISO 8601 if known, else None
    employment_type: Optional[str] = None  # "FULLTIME" | "CONTRACTOR" | etc.
    is_remote: Optional[bool] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[str] = None    # "yearly" | "hourly" | etc.
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    def to_public_dict(self) -> dict[str, Any]:
        """Serializable form for API + chat. Excludes `raw`."""
        d = asdict(self)
        d.pop("raw", None)
        return d


class JobProvider(ABC):
    """Base class. Every provider implements `search`."""

    name: str = "base"

    @abstractmethod
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
        """
        Args:
            query: keyword/title search ("senior backend engineer")
            location: city/state/country string, or None for any
            remote: True = remote-only, False = on-site-only, None = either
            employment_type: "fulltime" | "parttime" | "contract" | "internship" | None
            country: ISO 2-letter, lower-case ("us", "ca", "gb")
            limit: max listings to return (provider may return fewer)

        Returns: list of JobListing, possibly empty. Never raises for
        "no results"; only raises on real errors (auth, network, etc.).
        """
        ...