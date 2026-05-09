# backend/app/routers/bullet_rewrites.py
"""
Bullet rewriter — single endpoint, no persistence.
The frontend keeps the result in component state until the user picks one.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, get_current_user
from app.schemas import BulletRewriteIn, BulletRewriteOut, BulletVariant
from app.services.bullet_rewriter import run_bullet_rewrite

router = APIRouter(prefix="/api/v1/bullet-rewrites", tags=["bullet_rewrites"])


@router.post("", response_model=BulletRewriteOut)
def rewrite_bullet(
    payload: BulletRewriteIn,
    user: CurrentUser = Depends(get_current_user),
):
    try:
        result = run_bullet_rewrite(
            bullet=payload.bullet,
            job_description=payload.job_description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AI returned bad output: {e}")

    raw_variants = result.get("variants") or []
    if len(raw_variants) != 3:
        raise HTTPException(
            status_code=502,
            detail=f"Expected 3 variants from AI, got {len(raw_variants)}",
        )

    variants = [
        BulletVariant(
            style=v.get("style", "?"),
            text=v.get("text", ""),
            rationale=v.get("rationale"),
        )
        for v in raw_variants
    ]

    return BulletRewriteOut(original=payload.bullet, variants=variants)