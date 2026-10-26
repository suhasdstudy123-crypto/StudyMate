"""
GET /courses/{course_id}/search?q=...   search ONE of my courses (Stage 6)

    question ─► embedding model (with the instruction line) ─► 1024 numbers
             └─► hybrid_search_chunks() in PostgreSQL:
                   meaning (pgvector) + keywords (full-text) -> RRF merge
             ─► best passages with file, page, type and how each was found

The search itself is ONE stored-function call (migration 005); this file
only checks the request, embeds the question and shapes the answer.
Stage 7's chat reuses exactly the same search.
"""

import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import User
from backend.app.processing import embed_worker
from backend.app.processing.embeddings import embedder
from backend.app.routers.courses import get_owned_course_or_404
from backend.app.schemas import SearchHit, SearchResponse

router = APIRouter(prefix="/courses", tags=["Search"])

MAX_QUESTION_CHARS = 500

# Bind parameters (:v, :q, ...) as everywhere: the question is sent to
# PostgreSQL as DATA, never pasted into the SQL text (no SQL injection).
# CAST(:v AS vector): the vector travels as text "[0.1,0.2,...]" and
# PostgreSQL turns it into a VECTOR; NULL stays NULL (keywords only).
SEARCH_SQL = text("""
    SELECT chunk_id, material_id, material_title, page_number, chunk_type, source,
           content, score, meaning_rank, keyword_rank, similarity
    FROM hybrid_search_chunks(CAST(:v AS vector), :q, :user_id, :course_id, :k)
""")


def search_course(db: Session, user: User, course_id: UUID, question: str, k: int) -> SearchResponse:
    """The whole search, as a function so the Stage 7 chat can call it too."""
    started = time.perf_counter()
    # Meaning search needs the model. While it's still loading after a
    # restart (or if it's switched off), search keywords only instead of
    # making the student wait or fail.
    if embed_worker.state.loaded:
        vector = str(embedder.embed_query(question))
        mode = "hybrid"
    else:
        vector = None
        mode = "keywords"
    rows = db.execute(
        SEARCH_SQL, {"v": vector, "q": question, "user_id": user.id, "course_id": course_id, "k": k}
    ).mappings().all()
    return SearchResponse(
        query=question,
        mode=mode,
        took_ms=round((time.perf_counter() - started) * 1000),
        results=[SearchHit(**r) for r in rows],
    )


@router.get("/{course_id}/search", response_model=SearchResponse)
def search(
    course_id: UUID,
    q: str = Query(..., description="The question or words to look for", max_length=MAX_QUESTION_CHARS),
    k: int = Query(8, ge=1, le=20, description="How many passages to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    question = q.strip()
    if not question:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a question or some words to search for")
    # Someone else's course (or a made-up id) -> 404, same as everywhere.
    get_owned_course_or_404(db, course_id, current_user)
    return search_course(db, current_user, course_id, question, k)
