"""
The embedding worker: ONE background thread that gives every passage its
vector (Stage 6).

    loop:
      1. take up to 32 passages that have no vector yet      (the to-do list)
      2. embedding model -> 1024 numbers each                 (embeddings.py)
      3. save vector + model name + real token count          (one transaction)
      4. repeat; when nothing is left, sleep until woken up

Who wakes it up?
  * the text pass, right after a file's passages are committed  (worker.py)
  * the image reader, right after it saves passages            (vision_worker.py)
  * startup: passages that were never embedded (e.g. the ones that existed
    before Stage 6) are simply on the to-do list, so they are done first

Why does the to-do list live in the DATABASE ("embedding IS NULL") and not
in memory? Nothing can be forgotten: a restart, a crash or a file uploaded
while the model was loading -> the passages are still NULL, still on the list.
The partial index idx_chunks_needs_embedding (migration 004) keeps that
lookup fast: it only contains passages without a vector.

Why one thread? The model uses the whole GPU (or all CPU cores) for one
batch anyway; two threads would only take turns.
"""

import logging
import threading
import time
from dataclasses import dataclass

from sqlalchemy import bindparam, text, update

from backend.app.config import EMBEDDING_ENABLED
from backend.app.database import SessionLocal
from backend.app.models import DocumentChunk
from backend.app.processing.embeddings import MAX_TOKENS, embedder

log = logging.getLogger("studymate.embeddings")

BATCH = 32  # passages per round (the model splits them into smaller GPU batches)


@dataclass
class EmbedState:
    enabled: bool = False
    loaded: bool = False        # model ready (search can embed questions)
    device: str | None = None   # "cuda" or "cpu"
    error: str | None = None    # model couldn't be loaded / last round failed


state = EmbedState()
_wake = threading.Event()   # set = "new passages are waiting, look now"
_stop = threading.Event()
_thread: threading.Thread | None = None


def wake() -> None:
    _wake.set()


# ------------------------------------------------------------------
# Database steps
# ------------------------------------------------------------------

# The to-do list. Only files that are 'ready': while a file is re-read
# ('processing'), its old passages are about to be replaced, so embedding
# them would be wasted work. Oldest file first, passages in reading order.
TODO_SQL = text("""
    SELECT dc.id, dc.content
    FROM document_chunks dc
    JOIN materials m ON m.id = dc.material_id
    WHERE dc.embedding IS NULL AND m.status = 'ready'
    ORDER BY m.created_at, dc.material_id, dc.chunk_index
    LIMIT :n
""")

# Save one passage's vector. "AND embedding IS NULL": if the passage was
# deleted meanwhile (file deleted / page re-read) nothing happens, and a
# passage is never overwritten twice by accident.
# Written against the TABLE (plain SQL UPDATE), not the ORM class: we never
# load passages as Python objects here, so there's nothing to keep in sync.
# The column's Vector type still turns the Python list into a pgvector value.
_chunks = DocumentChunk.__table__
SAVE = (
    update(_chunks)
    .where(_chunks.c.id == bindparam("chunk_id"), _chunks.c.embedding.is_(None))
    .values(
        embedding=bindparam("vector"),
        embedding_model=bindparam("model"),
        token_count=bindparam("tokens"),
    )
)


def forget_other_models() -> int:
    """Startup: vectors made by a DIFFERENT model than the current one can't
    be compared with new question vectors, so they go back on the to-do list.
    (Normally 0 rows; only after EMBEDDING_MODEL was changed.)"""
    with SessionLocal() as db:
        n = db.execute(
            text(
                "UPDATE document_chunks SET embedding = NULL, embedding_model = NULL "
                "WHERE embedding_model IS DISTINCT FROM :model AND embedding IS NOT NULL"
            ),
            {"model": embedder.model_name},
        ).rowcount
        db.commit()
    return n


def remaining() -> int:
    with SessionLocal() as db:
        return db.execute(text(
            "SELECT count(*) FROM document_chunks dc JOIN materials m ON m.id = dc.material_id "
            "WHERE dc.embedding IS NULL AND m.status = 'ready'"
        )).scalar_one()


def run_once(n: int = BATCH) -> int:
    """Embed one round of passages. Returns how many were taken (0 = nothing to do)."""
    with SessionLocal() as db:
        rows = db.execute(TODO_SQL, {"n": n}).all()
    if not rows:
        return 0

    texts = [r.content for r in rows]
    # The slow part runs with NO database transaction open: a long open
    # transaction would hold locks and block e.g. deleting that file.
    started = time.perf_counter()
    vectors = embedder.embed_passages(texts)
    tokens = embedder.count_tokens(texts)
    seconds = time.perf_counter() - started

    too_long = sum(t > MAX_TOKENS for t in tokens)
    if too_long:
        log.warning("%d passage(s) longer than %d tokens: only the start was embedded", too_long, MAX_TOKENS)

    with SessionLocal() as db:
        db.execute(
            SAVE,
            [
                {"chunk_id": r.id, "vector": v, "model": embedder.model_name, "tokens": t}
                for r, v, t in zip(rows, vectors, tokens)
            ],
        )
        db.commit()
    log.info("Embedded %d passage(s) in %.1f s", len(rows), seconds)
    return len(rows)


# ------------------------------------------------------------------
# The thread
# ------------------------------------------------------------------

def _loop() -> None:
    # 1. Load the model here, not at server start: it takes seconds, and the
    #    rest of the website should be usable meanwhile.
    try:
        embedder.load()
    except Exception as e:
        state.error = f"The embedding model couldn't be loaded: {e}"
        log.exception("Embedding model %s couldn't be loaded; meaning search is off", embedder.model_name)
        return
    state.loaded = True
    state.device = embedder.device

    redo = forget_other_models()
    if redo:
        log.info("%d passage(s) were embedded with another model: redoing them", redo)
    waiting = remaining()
    if waiting:
        log.info("%d passage(s) waiting to be embedded", waiting)

    # 2. Work through the to-do list; sleep when it's empty.
    error_streak = 0
    busy = False
    while not _stop.is_set():
        _wake.clear()  # cleared BEFORE looking, so a wake() during the round isn't lost
        try:
            taken = run_once()
            state.error = None
            error_streak = 0
        except Exception as e:
            # e.g. GPU out of memory, database down. The passages stay on the
            # to-do list; try again later (15 s, 30 s, 60 s ... max 10 min).
            log.exception("Embedding round failed")
            state.error = str(e)
            error_streak += 1
            _wake.wait(timeout=min(15 * 2 ** (error_streak - 1), 600))
            continue
        if taken:
            busy = True
            continue  # more may be waiting: go straight on
        if busy:
            log.info("All passages are embedded")
            busy = False
        # Nothing to do: sleep until woken (new passages) or 60 s, whichever first.
        _wake.wait(timeout=60)


def start() -> None:
    global _thread
    if not EMBEDDING_ENABLED:
        state.enabled = False
        log.warning("EMBEDDING_ENABLED=false: passages are not embedded, meaning search is off")
        return
    state.enabled = True
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="embedder", daemon=True)
    _thread.start()
    log.info("Embedding worker started (%s); loading the model in the background", embedder.model_name)


def stop() -> None:
    _stop.set()
    _wake.set()  # interrupt the sleep
