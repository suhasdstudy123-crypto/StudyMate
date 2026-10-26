"""
The image reader's queue: ONE background thread that reads waiting pages.

    loop:
      1. pick a model: the main one, or the fallback if the main one's
         daily quota is used up; if both are, sleep until the daily reset
      2. wait until the per-minute limit allows another request
      3. CLAIM up to 5 waiting pages of one file      (pending -> processing)
      4. send their pictures to Gemini                (vision.py)
      5. SAVE the passages in ONE transaction         (processing -> done)
         or, on an error, put the pages back / mark them failed

Why one thread? The limit is a few requests per MINUTE: parallel threads
couldn't go faster, they'd only make counting requests harder.

Why does the queue live in the DATABASE (vision_status) and not in memory?
A restart loses nothing: waiting pages are still 'pending' in the table, and
pages that were mid-request ('processing') are put back on startup.
"""

import logging
import threading
import time
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text

from backend.app.config import (
    GEMINI_API_KEY,
    VISION_FALLBACK_MODEL,
    VISION_FALLBACK_RPD,
    VISION_FALLBACK_RPM,
    VISION_MAX_ATTEMPTS,
    VISION_MODEL,
    VISION_MODEL_RPD,
    VISION_MODEL_RPM,
    VISION_PAGES_PER_REQUEST,
)
from backend.app.database import SessionLocal
from backend.app.processing import embed_worker
from backend.app.processing.rate_limit import ModelLimiter
from backend.app.processing.vision import (
    GeminiReader,
    PageInput,
    QuotaExceeded,
    ReaderConfigError,
    ServerBusy,
    VisionError,
    VisionResult,
    passages_to_chunks,
)
from backend.app.storage import absolute_path

log = logging.getLogger("studymate.vision")


# ------------------------------------------------------------------
# State shared with the API (GET /vision/status)
# ------------------------------------------------------------------

@dataclass
class ReaderState:
    enabled: bool = False
    model: str | None = None           # model used for the last request
    paused_until: float | None = None  # all models used up / resting until (Unix time)
    pause_reason: str | None = None    # "quota" (daily limit) or "busy" (Google overloaded)
    last_error: str | None = None
    config_error: str | None = None    # key/model rejected: paused until fixed


state = ReaderState()
_wake = threading.Event()   # set = "new pages are waiting, look now"
_stop = threading.Event()
_thread: threading.Thread | None = None

limiters: list[ModelLimiter] = [ModelLimiter(VISION_MODEL, VISION_MODEL_RPM, VISION_MODEL_RPD)]
if VISION_FALLBACK_MODEL and VISION_FALLBACK_MODEL != VISION_MODEL:
    limiters.append(ModelLimiter(VISION_FALLBACK_MODEL, VISION_FALLBACK_RPM, VISION_FALLBACK_RPD))


def wake() -> None:
    """Called when pages become 'pending' (new upload, retry)."""
    _wake.set()


# ------------------------------------------------------------------
# Database steps
# ------------------------------------------------------------------

@dataclass
class ClaimedPage:
    material_id: UUID
    page_number: int
    image_path: str
    attempts: int
    known_text: str


# One statement claims a batch: pick the oldest file that has waiting pages,
# take up to :n of its pages, and flip them to 'processing'.
#   FOR UPDATE SKIP LOCKED: if another process is claiming the same rows right
#   now (e.g. two backend processes), skip them instead of waiting; no page is
#   ever claimed twice.
#   Only files whose text pass is finished ('ready') and pages whose picture
#   is saved can be read.
#   :last_try picks between two kinds of pages (see claim_batch).
CLAIM_SQL = text("""
    WITH next_file AS (
        SELECT p.material_id
        FROM document_pages p
        JOIN materials m ON m.id = p.material_id
        WHERE p.vision_status = 'pending' AND p.image_path IS NOT NULL AND m.status = 'ready'
          AND (p.vision_attempts >= :last) = :last_try
        ORDER BY m.created_at, p.material_id
        LIMIT 1
    ),
    batch AS (
        SELECT p.material_id, p.page_number
        FROM document_pages p
        JOIN next_file f ON f.material_id = p.material_id
        WHERE p.vision_status = 'pending' AND p.image_path IS NOT NULL
          AND (p.vision_attempts >= :last) = :last_try
        ORDER BY p.page_number
        LIMIT :n
        FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE document_pages p
       SET vision_status = 'processing', vision_attempts = p.vision_attempts + 1
      FROM batch
     WHERE p.material_id = batch.material_id AND p.page_number = batch.page_number
    RETURNING p.material_id, p.page_number, p.image_path, p.vision_attempts
""")


def claim_batch(n: int = VISION_PAGES_PER_REQUEST) -> list[ClaimedPage]:
    """Normally up to n pages in one request. But a page on its LAST try is
    read ALONE: if one page in a batch breaks the request, its neighbours
    would otherwise fail with it. (The first tries stay batched: most errors,
    like a busy server, hit the whole request anyway, and splitting early
    would spend more of the small daily quota.)"""
    last = VISION_MAX_ATTEMPTS - 1
    with SessionLocal() as db:
        rows = db.execute(CLAIM_SQL, {"n": 1, "last": last, "last_try": True}).all()
        if not rows:
            rows = db.execute(CLAIM_SQL, {"n": n, "last": last, "last_try": False}).all()
        db.commit()
        if not rows:
            return []
        material_id = rows[0].material_id
        numbers = sorted(r.page_number for r in rows)
        # The exact text 5a already read from these pages (to tell Gemini
        # "don't repeat this").
        known = db.execute(
            text(
                "SELECT page_number, string_agg(content, E'\\n\\n' ORDER BY chunk_index) AS text "
                "FROM document_chunks WHERE material_id = :m AND page_number = ANY(:pages) "
                "AND source = 'pdf_text' GROUP BY page_number"
            ),
            {"m": material_id, "pages": numbers},
        ).all()
    known_by_page = {k.page_number: k.text for k in known}
    return [
        ClaimedPage(r.material_id, r.page_number, r.image_path, r.vision_attempts, known_by_page.get(r.page_number, ""))
        for r in sorted(rows, key=lambda r: r.page_number)
    ]


def save_results(material_id: UUID, pages: list[ClaimedPage], result: VisionResult, model: str) -> list[ClaimedPage]:
    """Store the passages of every page Gemini answered, in ONE transaction:
    either all of this batch's passages + 'done' marks are saved, or nothing.
    Returns the pages Gemini skipped (they go back to the queue)."""
    wanted = {p.page_number for p in pages}
    answers: dict[int, list] = {}
    for page in result.pages:
        if page.page_number in wanted:  # ignore page numbers we didn't ask about
            answers.setdefault(page.page_number, []).extend(page.passages)

    with SessionLocal() as db:
        # Lock the file's row. Two reasons:
        #  * if it was deleted while Gemini was reading, there's no row: we
        #    simply drop the answer (nothing to attach it to);
        #  * chunk_index must be unique per file; the lock makes "highest
        #    index + 1" safe even if something else adds chunks at once.
        exists = db.execute(
            text("SELECT 1 FROM materials WHERE id = :m FOR UPDATE"), {"m": material_id}
        ).scalar()
        if not exists:
            db.rollback()
            log.info("File %s was deleted while its pages were being read", material_id)
            return []
        next_index = db.execute(
            text("SELECT coalesce(max(chunk_index), -1) + 1 FROM document_chunks WHERE material_id = :m"),
            {"m": material_id},
        ).scalar_one()

        done = sorted(answers)
        # A retried page replaces its old image-reader passages (never the exact text ones).
        db.execute(
            text("DELETE FROM document_chunks WHERE material_id = :m AND page_number = ANY(:pages) AND source = 'vision'"),
            {"m": material_id, "pages": done},
        )
        rows = []
        for number in done:
            for chunk in passages_to_chunks(answers[number]):
                rows.append({
                    "m": material_id, "i": next_index + len(rows), "p": number,
                    "c": chunk.content, "t": chunk.token_count, "k": chunk.chunk_type,
                })
        if rows:
            db.execute(
                text(
                    "INSERT INTO document_chunks (material_id, chunk_index, page_number, content, token_count, chunk_type, source) "
                    "VALUES (:m, :i, :p, :c, :t, :k, 'vision')"
                ),
                rows,
            )
        db.execute(
            text(
                "UPDATE document_pages SET vision_status = 'done', vision_model = :model, vision_error = NULL "
                "WHERE material_id = :m AND page_number = ANY(:pages)"
            ),
            {"m": material_id, "pages": done, "model": model},
        )
        db.commit()
    log.info("Read %d page(s) of %s with %s: %d passages", len(done), material_id, model, len(rows))
    if rows:
        embed_worker.wake()  # the new picture passages need vectors too
    return [p for p in pages if p.page_number not in answers]


def release(pages: list[ClaimedPage], error: str | None, count_attempt: bool) -> None:
    """Put pages back after a problem.
    count_attempt=False: not the page's fault (quota) -> undo the attempt.
    Otherwise a page that has failed VISION_MAX_ATTEMPTS times is marked
    'failed' with the reason; the rest go back to 'pending'."""
    if not pages:
        return
    with SessionLocal() as db:
        for p in pages:
            attempts = p.attempts if count_attempt else p.attempts - 1
            failed = count_attempt and attempts >= VISION_MAX_ATTEMPTS
            db.execute(
                text(
                    "UPDATE document_pages SET vision_status = :s, vision_attempts = :a, vision_error = :e "
                    "WHERE material_id = :m AND page_number = :n AND vision_status = 'processing'"
                ),
                {
                    "s": "failed" if failed else "pending",
                    "a": max(attempts, 0),
                    "e": (error or "The image reader couldn't read this page.") if failed else None,
                    "m": p.material_id,
                    "n": p.page_number,
                },
            )
        db.commit()


def reset_interrupted() -> int:
    """Startup: pages that were mid-request when the server stopped go back
    to the queue. Their attempt doesn't count (the server stopped, not them)."""
    with SessionLocal() as db:
        n = db.execute(text(
            "UPDATE document_pages SET vision_status = 'pending', vision_attempts = greatest(vision_attempts - 1, 0) "
            "WHERE vision_status = 'processing'"
        )).rowcount
        db.commit()
    return n


# ------------------------------------------------------------------
# One round of the loop (separate function so tests can call it directly)
# ------------------------------------------------------------------

def pick_limiter() -> ModelLimiter | None:
    for limiter in limiters:
        if limiter.used_up_until() is None:
            return limiter
    return None


def run_once(reader) -> str:
    """Do at most one request. Returns what happened, for the loop and tests:
    'idle' (nothing waiting), 'paused' (all quotas used up), 'wait' (per-minute
    limit), 'read', 'quota', 'error', 'config' (key/model rejected)."""
    limiter = pick_limiter()
    if limiter is None:
        state.paused_until = min(l.used_up_until() or 0 for l in limiters)
        state.pause_reason = "busy" if any(l.resting() for l in limiters) else "quota"
        return "paused"
    state.paused_until = None
    state.pause_reason = None
    if limiter.wait_seconds() > 0:
        return "wait"

    pages = claim_batch()
    if not pages:
        return "idle"
    material_id = pages[0].material_id

    try:
        inputs = [PageInput(p.page_number, absolute_path(p.image_path).read_bytes(), p.known_text) for p in pages]
    except (OSError, ValueError):
        log.exception("Page picture missing for %s", material_id)
        release(pages, "The page picture is missing. Re-upload the file.", count_attempt=True)
        return "error"

    limiter.record()  # before sending: Google counts failed requests too
    state.model = limiter.model
    log.info(
        "Sending page(s) %s of %s to %s (request %d of %d today)",
        [p.page_number for p in pages], material_id, limiter.model, limiter.requests_today, limiter.per_day,
    )
    try:
        result = reader.read(limiter.model, inputs)
    except QuotaExceeded as q:
        release(pages, None, count_attempt=False)
        if q.daily:
            limiter.block_for_today()
            log.warning("%s: daily quota used up; switching model or pausing until the reset", limiter.model)
        else:
            limiter.slow_down(q.retry_after)
            log.info("%s: per-minute limit hit; waiting %.0f s", limiter.model, q.retry_after)
        return "quota"
    except ServerBusy as e:
        # Google is overloaded: not the pages' fault, so the attempt doesn't
        # count. The first two times just wait a bit; if it keeps happening,
        # rest this model for 10 minutes so the fallback model takes over.
        release(pages, None, count_attempt=False)
        limiter.busy_streak += 1
        state.last_error = str(e)
        if limiter.busy_streak < 3:
            limiter.slow_down(30 * limiter.busy_streak)
            log.warning("%s is busy (%s); waiting %d s", limiter.model, e, 30 * limiter.busy_streak)
        else:
            limiter.rest(600)
            limiter.busy_streak = 0
            log.warning("%s keeps being busy; resting it for 10 min (fallback model takes over)", limiter.model)
        return "busy"
    except ReaderConfigError as e:
        # Not the pages' fault: back to the queue, attempt not counted.
        release(pages, None, count_attempt=False)
        state.config_error = str(e)
        log.error("Image reader paused: %s. Check GEMINI_API_KEY / VISION_MODEL in backend/.env", e)
        return "config"
    except VisionError as e:
        state.last_error = str(e)
        log.warning("Image reader failed for %s pages %s: %s", material_id, [p.page_number for p in pages], e)
        release(pages, str(e), count_attempt=True)
        return "error"

    state.last_error = None
    state.config_error = None
    limiter.busy_streak = 0
    skipped = save_results(material_id, pages, result, limiter.model)
    if skipped:
        release(skipped, "Gemini didn't return this page.", count_attempt=True)
    return "read"


# ------------------------------------------------------------------
# The thread
# ------------------------------------------------------------------

def _loop(reader) -> None:
    error_streak = 0
    while not _stop.is_set():
        _wake.clear()  # cleared BEFORE looking, so a wake() during the round isn't lost
        try:
            outcome = run_once(reader)
        except Exception:
            log.exception("Image reader loop error")
            outcome = "error"
        error_streak = error_streak + 1 if outcome == "error" else 0

        if outcome == "read":
            continue  # more pages may be waiting: go straight on
        if outcome in ("wait", "quota", "busy"):
            limiter = pick_limiter()
            delay = limiter.wait_seconds() if limiter else 5.0
        elif outcome == "paused":
            delay = (state.paused_until or time.time()) - time.time()
        elif outcome == "error":
            delay = 15 * 2 ** (error_streak - 1)  # 15 s, 30 s, 60 s, ... (backoff)
        elif outcome == "config":
            delay = 600  # a wrong key won't fix itself; restarting the server re-checks
        else:  # idle
            delay = 60
        # Sleep, but wake early when new pages arrive (wake()) or on stop().
        # Never more than 10 min: the clock may have jumped, re-check then.
        _wake.wait(timeout=min(max(delay, 1.0), 600))


def start() -> None:
    global _thread
    interrupted = reset_interrupted()
    if interrupted:
        log.info("Put %d interrupted page(s) back in the image reader's queue", interrupted)
    if not GEMINI_API_KEY:
        state.enabled = False
        log.warning("GEMINI_API_KEY is not set: picture pages will wait until a key is added")
        return
    state.enabled = True
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(GeminiReader(GEMINI_API_KEY),), name="vision-reader", daemon=True)
    _thread.start()
    log.info("Image reader started (%s)", " -> ".join(l.model for l in limiters))


def stop() -> None:
    _stop.set()
    _wake.set()  # interrupt the sleep
