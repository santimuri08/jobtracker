# backend/app/scheduler.py
"""
APScheduler setup. One in-process scheduler running inside the FastAPI worker.

Started in main.py via the lifespan context manager. The weekly summary job
fires every Monday at 9:00 AM (server timezone).
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import SessionLocal
from app.services.weekly_summary_job import run_for_all_users

logger = logging.getLogger(__name__)

scheduler: BackgroundScheduler | None = None


def _weekly_summary_tick() -> None:
    """Wrapper that opens its own DB session and runs the batch."""
    logger.info("scheduler tick: weekly_summary")
    db = SessionLocal()
    try:
        run_for_all_users(db)
    except Exception:  # noqa: BLE001
        logger.exception("weekly_summary tick crashed")
    finally:
        db.close()


def start_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        _weekly_summary_tick,
        trigger=CronTrigger(day_of_week="mon", hour=9, minute=0),
        id="weekly_summary",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("scheduler started: weekly_summary cron mon@09:00 UTC")


def stop_scheduler() -> None:
    global scheduler
    if scheduler is None:
        return
    scheduler.shutdown(wait=False)
    scheduler = None
    logger.info("scheduler stopped")