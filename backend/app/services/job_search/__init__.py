# backend/app/services/job_search/__init__.py
"""Provider-agnostic job search package."""
from app.services.job_search.base import JobListing, JobProvider
from app.services.job_search.registry import get_provider

__all__ = ["JobListing", "JobProvider", "get_provider"]