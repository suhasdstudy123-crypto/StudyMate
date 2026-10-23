"""
Step 3: the BACKGROUND WORKER that reads an uploaded PDF and stores
its pages and chunks.

Why in the background? Reading a 200-page PDF takes seconds to a minute.
If the upload request waited for that, the browser would sit there
"loading" (and could time out). Instead:

    upload request:  save file -> insert material (status 'pending')
                     -> put it in the queue -> answer 202 Accepted at once
    worker thread:   pending -> processing (page 1/40, 2/40, ...) -> ready
    browser:         asks "how far along?" every second or two (polling)

The queue is a ThreadPoolExecutor: a few threads inside the backend process
that take jobs one by one. It's not a separate service (like Celery +
Redis), which keeps the project simple. The cost: jobs are lost if the
server stops, so on startup we put unfinished files back in the queue.

TWO database sessions (two connections), on purpose:
  * `work`     ONE transaction for ALL pages and chunks of the file. It is
               committed only at the very end -> a file is either fully
               searchable or not at all; a crash halfway leaves NOTHING half-done
               (atomicity).
  * `progress` tiny transactions committed after every page, so the
               browser sees "page 12 of 40" while `work` is still open.
Other connections can't see `work`'s uncommitted rows (isolation, READ
COMMITTED), but they CAN see each committed progress update.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import pymupdf
from sqlalchemy import delete, insert, text, update

from backend.app.config import PROCESSING_WORKERS
from backend.app.database import SessionLocal
from backend.app.models import DocumentChunk, DocumentPage, Material
from backend.app.processing.chunking import chunk_page
from backend.app.processing.extract import analyse_document, extract_page, is_heading
from backend.app.storage import absolute_path

log = logging.getLogger("studymate.processing")

_executor = ThreadPoolExecutor(max_workers=PROCESSING_WORKERS, thread_name_prefix="pdf-worker")


def enqueue(material_id: UUID) -> None:
    _executor.submit(process_material, material_id)


def requeue_unfinished() -> int:
    """Called at startup. A file that was 'processing' when the server stopped
    never finished (its transaction was rolled back), so it starts again."""
    with SessionLocal() as db:
        db.execute(text("UPDATE materials SET status = 'pending', pages_processed = 0 WHERE status = 'processing'"))
        db.commit()
        ids = db.execute(text("SELECT id FROM materials WHERE status = 'pending' ORDER BY created_at")).scalars().all()
    for material_id in ids:
        enqueue(material_id)
    return len(ids)


def shutdown() -> None:
    # Don't wait for long jobs on shutdown; they're re-queued on next start.
    _executor.shutdown(wait=False, cancel_futures=True)


def process_material(material_id: UUID) -> None:
    progress = SessionLocal()
    work = SessionLocal()
    current_page = 0
    try:
        # ---- 1. Claim the job -------------------------------------------
        # A CONDITIONAL update: only flips 'pending' -> 'processing'. If two
        # workers got the same id, only one UPDATE matches the row; the other
        # gets no row back and stops. (Also stops if the file was deleted.)
        claimed = progress.execute(
            text(
                "UPDATE materials SET status = 'processing', pages_processed = 0, error_message = NULL "
                "WHERE id = :id AND status = 'pending' RETURNING stored_path"
            ),
            {"id": material_id},
        ).scalar_one_or_none()
        progress.commit()
        if claimed is None:
            return

        # Read the bytes into memory and close the file at once, so a
        # Windows "file is in use" lock can't block deleting it later.
        data = absolute_path(claimed).read_bytes()
        doc = pymupdf.open(stream=data, filetype="pdf")

        # ---- 2. Clean slate (matters on a retry) ------------------------
        work.execute(delete(DocumentChunk).where(DocumentChunk.material_id == material_id))
        work.execute(delete(DocumentPage).where(DocumentPage.material_id == material_id))

        # ---- 3. Read every page -----------------------------------------
        profile = analyse_document(doc)  # pass 1: what repeats (headers, logo)
        heading = None
        chunk_index = 0
        for index in range(doc.page_count):
            current_page = index + 1
            content, heading = extract_page(doc[index], profile, heading)
            chunks = chunk_page(content.items, is_heading)

            work.execute(
                insert(DocumentPage).values(
                    material_id=material_id,
                    page_number=content.page_number,
                    char_count=content.char_count,
                    table_count=content.table_count,
                    image_count=content.image_count,
                    drawing_count=content.drawing_count,
                    math_symbol_count=content.math_symbol_count,
                    needs_vision=content.needs_vision,
                )
            )
            if chunks:
                work.execute(
                    insert(DocumentChunk),
                    [
                        {
                            "material_id": material_id,
                            "chunk_index": chunk_index + i,
                            "page_number": content.page_number,
                            "chunk_type": c.chunk_type,
                            "content": c.content,
                            "token_count": c.token_count,
                        }
                        for i, c in enumerate(chunks)
                    ],
                )
                chunk_index += len(chunks)

            # Progress: its own tiny transaction, visible to the browser now.
            progress.execute(
                update(Material).where(Material.id == material_id).values(pages_processed=current_page)
            )
            progress.commit()

        # ---- 4. Done: everything becomes visible in ONE commit ----------
        work.execute(
            update(Material)
            .where(Material.id == material_id)
            .values(status="ready", page_count=doc.page_count, pages_processed=doc.page_count)
        )
        work.commit()
        log.info("Processed material %s: %d pages, %d chunks", material_id, doc.page_count, chunk_index)

    except Exception:
        log.exception("Processing failed for material %s (page %s)", material_id, current_page)
        work.rollback()      # undo every page/chunk inserted so far
        progress.rollback()
        where = f" on page {current_page}" if current_page else ""
        try:
            # One transaction: remove anything left from an earlier run AND
            # mark the file failed. Rule: a failed file stores no pages or
            # chunks, only the reason. (Deleting pages cascades to chunks.)
            progress.execute(delete(DocumentPage).where(DocumentPage.material_id == material_id))
            progress.execute(
                text("UPDATE materials SET status = 'failed', error_message = :msg WHERE id = :id"),
                {
                    "id": material_id,
                    "msg": f"StudyMate couldn't read this PDF{where}. Try again; if it keeps failing, the file may be damaged.",
                },
            )
            progress.commit()
        except Exception:
            log.exception("Could not mark material %s as failed", material_id)
    finally:
        work.close()
        progress.close()
