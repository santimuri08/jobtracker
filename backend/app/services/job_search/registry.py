# backend/app/services/job_search/registry.py
"""
Resolves the active JobProvider based on settings.

Fallback rule: if the configured provider requires a key and the key
is empty, we log a warning and use MockProvider instead. This keeps
the rest of the stack functional in dev/CI environments where keys
aren't set, and prevents 500s in production from a missing env var.
"""
from __future__ import annotations

import logging
from functools import lru_cache

from app.config import settings
from app.services.job_search.base import JobProvider
from app.services.job_search.jsearch import JSearchProvider
from app.services.job_search.mock import MockProvider

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_provider() -> JobProvider:
    """
    Returns a singleton provider instance.

    Cached because providers are stateless after construction, and
    re-reading settings on every tool call is wasted work.

    Note: if you change JOB_SEARCH_PROVIDER at runtime, you need to
    restart the backend (or call get_provider.cache_clear() in tests).
    """
    name = (settings.job_search_provider or "mock").lower().strip()

    if name == "jsearch":
        if not settings.rapidapi_key:
            logger.warning(
                "JOB_SEARCH_PROVIDER=jsearch but RAPIDAPI_KEY is empty — "
                "falling back to MockProvider."
            )
            return MockProvider()
        logger.info("job_search provider: jsearch")
        return JSearchProvider(api_key=settings.rapidapi_key)

    if name == "mock":
        logger.info("job_search provider: mock")
        return MockProvider()

    logger.warning(
        "Unknown JOB_SEARCH_PROVIDER=%r — falling back to MockProvider.",
        name,
    )
    return MockProvider()