"""
Backfill service and CLI script for generating embeddings for existing document chunks.

Can be run safely at any time:
    python -m backend.app.processing.backfill_embeddings

Features:
- Idempotent: only touches chunks where embedding IS NULL.
- Resumable: commits after each batch so progress is never lost on interruption.
- Safe: never alters text content or deletes chunks.
"""

import logging
import sys
from uuid import UUID

from sqlalchemy import text

from backend.app.database import SessionLocal
from backend.app.services.embeddings import embed_texts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("studymate.backfill")


def backfill_missing_embeddings(batch_size: int = 50, limit: int | None = None) -> int:
    """Find and compute embeddings for all document chunks that lack one."""
    total_processed = 0

    with SessionLocal() as db:
        count_missing = db.execute(
            text("SELECT count(*) FROM document_chunks WHERE embedding IS NULL")
        ).scalar_one()

    log.info("Found %d chunks missing embeddings.", count_missing)
    if count_missing == 0:
        return 0

    while True:
        if limit is not None and total_processed >= limit:
            break

        current_batch_size = batch_size
        if limit is not None:
            current_batch_size = min(batch_size, limit - total_processed)

        with SessionLocal() as db:
            rows = db.execute(
                text(
                    "SELECT id, content FROM document_chunks "
                    "WHERE embedding IS NULL "
                    "ORDER BY created_at ASC "
                    "LIMIT :limit"
                ),
                {"limit": current_batch_size},
            ).all()

            if not rows:
                break

            ids = [r.id for r in rows]
            contents = [r.content for r in rows]

            try:
                vectors = embed_texts(contents, batch_size=len(contents))
                for chunk_id, vec in zip(ids, vectors):
                    db.execute(
                        text(
                            "UPDATE document_chunks SET embedding = :vec WHERE id = :id"
                        ),
                        {"vec": vec, "id": chunk_id},
                    )
                db.commit()
                total_processed += len(rows)
                log.info(
                    "Backfilled %d/%d chunks (%.1f%%)",
                    total_processed,
                    count_missing,
                    (total_processed / count_missing) * 100,
                )
            except Exception as e:
                db.rollback()
                log.exception("Error during backfill batch: %s", e)
                raise

    log.info("Finished backfilling. Total chunks updated: %d", total_processed)
    return total_processed


if __name__ == "__main__":
    try:
        updated = backfill_missing_embeddings()
        print(f"Successfully backfilled embeddings for {updated} chunk(s).")
    except Exception as exc:
        print(f"Backfill failed: {exc}", file=sys.stderr)
        sys.exit(1)
