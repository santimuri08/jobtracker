# backend/app/scripts/backfill_embeddings.py
"""
One-shot script: embed every application that has a job_description
but no embedding yet.

Run with:
    docker compose exec backend python -m app.scripts.backfill_embeddings
"""
from app.database import SessionLocal
from app.models import Application
from app.services.embeddings import (
    build_application_text,
    embed_documents_batch,
)

BATCH_SIZE = 16


def main() -> None:
    db = SessionLocal()
    try:
        apps_to_embed = (
            db.query(Application)
            .filter(Application.embedding.is_(None))
            .filter(Application.job_description.isnot(None))
            .filter(Application.job_description != "")
            .all()
        )

        if not apps_to_embed:
            print("Nothing to backfill — every JD-bearing application already has an embedding.")
            return

        print(f"Backfilling {len(apps_to_embed)} applications in batches of {BATCH_SIZE}...")

        for i in range(0, len(apps_to_embed), BATCH_SIZE):
            chunk = apps_to_embed[i : i + BATCH_SIZE]
            texts = [
                build_application_text(
                    company=a.company,
                    role=a.role,
                    location=a.location,
                    job_description=a.job_description,
                )
                for a in chunk
            ]
            vectors = embed_documents_batch(texts)
            for a, vec in zip(chunk, vectors):
                a.embedding = vec
            db.commit()
            print(f"  ✓ {min(i + BATCH_SIZE, len(apps_to_embed))} / {len(apps_to_embed)}")

        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()