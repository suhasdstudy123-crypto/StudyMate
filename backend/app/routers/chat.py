"""
The chat API (Stage 7).

    GET    /chat/status                     can the chat answer now? (which model)
    POST   /chat/sessions                   start a chat about one of my courses
    GET    /chat/sessions?course_id=        my chats, most recent first
    GET    /chat/sessions/{id}              one chat: questions, answers, sources
    DELETE /chat/sessions/{id}              delete a chat
    POST   /chat/sessions/{id}/messages     ask: the answer STREAMS back (SSE)

Streaming with Server-Sent Events (SSE): one HTTP response that stays open;
the server writes small text events into it as they happen:

    event: status   data: {"step": "searching"}
    event: sources  data: {"search_query": ..., "passages": [...]}   <- panel fills
    event: delta    data: {"text": "Atomicity means "}               <- repeated
    event: done     data: {"message_id": ..., "status": "answered", ...}
    (or)  event: error data: {"reason": "quota", "message": ..., "available_at": ...}

Why SSE and not WebSockets? The answer only flows ONE way (server -> browser)
and SSE is plain HTTP: same cookie auth, same /api proxy, nothing extra.

Saving: the question and its answer (+ sources) are saved together in ONE
transaction AFTER the answer is complete. A failed answer leaves no
half-saved question behind; the student just asks again. If the student
presses Stop, the part already shown is saved with status "stopped".
"""

import asyncio
import json
import logging
import random
import re
from datetime import datetime, timezone
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from backend.app.config import (
    CHAT_FALLBACK_MODEL,
    CHAT_MODEL,
    CHAT_PASSAGES,
    CHAT_REWRITE_MODEL,
    GEMINI_API_KEY,
    gemini_limits,
)
from backend.app.database import SessionLocal, get_db
from backend.app.deps import get_current_user
from backend.app.models import ChatMessage, ChatSession, DocumentChunk, MessageSource, User
from backend.app.processing import rag
from backend.app.processing.gemini import GeminiConfigError, GeminiError, QuotaExceeded, make_client
from backend.app.processing.rate_limit import limiter_for
from backend.app.routers.courses import get_owned_course_or_404
from backend.app.routers.search import search_course
from backend.app.schemas import (
    ChatMessageOut,
    ChatQuestion,
    ChatSessionCreate,
    ChatSessionDetail,
    ChatSessionSummary,
    ChatSource,
    ChatStatus,
    ChatSuggestions,
)

log = logging.getLogger("studymate.chat")
router = APIRouter(prefix="/chat", tags=["Chat"])

# The same limiter objects the picture reader uses (one per model).
# Main model first; dict.fromkeys drops a duplicate if both names are equal.
answer_limiters = [
    limiter_for(m, *gemini_limits(m)) for m in dict.fromkeys([CHAT_MODEL, CHAT_FALLBACK_MODEL]) if m
]
rewrite_limiter = limiter_for(CHAT_REWRITE_MODEL, *gemini_limits(CHAT_REWRITE_MODEL))

_client = None


def gemini_client():
    """One client for the whole app (created on first use)."""
    global _client
    if _client is None:
        _client = make_client(GEMINI_API_KEY, rag.ANSWER_TIMEOUT_MS)
    return _client


TITLE_CHARS = 80


# ------------------------------------------------------------------
# Status
# ------------------------------------------------------------------

def _utc(ts: float | None) -> datetime | None:
    return datetime.fromtimestamp(ts, timezone.utc) if ts else None


@router.get("/status", response_model=ChatStatus)
def chat_status(current_user: User = Depends(get_current_user)):
    if not GEMINI_API_KEY:
        return ChatStatus(status="off", model=None, main_model=CHAT_MODEL, available_at=None,
                          message="The chat is switched off: no Gemini API key is set on the server.")
    for limiter in answer_limiters:
        if limiter.used_up_until() is None:
            return ChatStatus(status="ok", model=limiter.model, main_model=CHAT_MODEL, message=None, available_at=None)
    until = min(l.used_up_until() or 0 for l in answer_limiters)
    busy = any(l.resting() for l in answer_limiters)
    return ChatStatus(
        status="paused", model=None, main_model=CHAT_MODEL, available_at=_utc(until),
        message="Google's chat models are overloaded right now." if busy
        else "Today's free limit for answers is used up.",
    )


# ------------------------------------------------------------------
# Suggested questions, built from the course's own headings
# ------------------------------------------------------------------
# Generic starters ("Summarise my notes") invite questions RAG answers badly:
# the search returns the top 8 passages, so a "summary" covers only those.
# Specific questions are what RAG is good at, so the suggestions name real
# topics from YOUR notes: the heading line every passage starts with.

HEADINGS_SQL = text("""
    SELECT split_part(dc.content, E'\n', 1) AS heading, dc.chunk_type, dc.source
    FROM document_chunks dc
    JOIN materials m ON m.id = dc.material_id
    WHERE m.course_id = :course_id AND m.status = 'ready'
    ORDER BY m.created_at, dc.page_number, dc.chunk_index
""")

# Slide titles that are not topics
NOT_TOPICS = {
    "outline", "agenda", "contents", "table of contents", "summary", "references", "questions",
    "thank you", "thanks", "any questions", "introduction", "overview", "recap", "review",
}
SUGGESTIONS = 4


def _topic(heading: str) -> str | None:
    """A heading line -> a clean topic name, or None if it isn't one."""
    if re.match(r"\s*(screenshot|image|photo|picture|logo)\b", heading, flags=re.I):
        return None                                   # a picture's label, not a topic
    h = re.sub(r"^(diagram|table|figure|chart)\s*:\s*", "", heading.strip(), flags=re.I)
    h = re.sub(r"^[•\-\u2022\u2023\u25aa\u27a2\u2756*#\s]+", "", h)        # bullets, markdown #
    h = re.sub(r"\s*\(\d+\s*/\s*\d+\)\s*$", "", h).strip(" :.-–—")      # "(1/2)" continuations
    words = h.split()
    if not (2 <= len(h) <= 60) or len(words) > 8 or h.endswith("?"):
        return None
    if not re.search(r"[A-Za-z]{3}", h) or h.lower() in NOT_TOPICS:
        return None
    # "Transaction Concept A transaction is delimited": the heading ran into
    # its first sentence (PDF text). A verb like "is" means it's a sentence.
    if re.search(r"\b(is|are|was|were|means|has|have|can|will|should|must)\b", h, flags=re.I):
        return None
    return h


@router.get("/suggestions", response_model=ChatSuggestions)
def suggestions(course_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_owned_course_or_404(db, course_id, current_user)
    topics: list[tuple[str, str]] = []          # (topic, chunk_type), in deck order
    seen: set[str] = set()
    for row in db.execute(HEADINGS_SQL, {"course_id": course_id}).mappings():
        topic = _topic(row["heading"])
        if topic and topic.lower() not in seen:
            seen.add(topic.lower())
            topics.append((topic, row["chunk_type"]))
    if not topics:
        return ChatSuggestions(suggestions=[])
    # Spread over the whole course (start, middle, end), with a little
    # randomness so the page doesn't always show the same four.
    picked: list[tuple[str, str]] = []
    buckets = min(SUGGESTIONS, len(topics))
    size = len(topics) / buckets
    for b in range(buckets):
        picked.append(random.choice(topics[int(b * size): max(int((b + 1) * size), int(b * size) + 1)]))
    return ChatSuggestions(suggestions=[
        f"Walk me through the {t} diagram" if kind == "diagram"
        else f"Walk me through the {t[0].lower() + t[1:]}" if t.lower().startswith("example")
        else f"Explain {t}"
        for t, kind in picked
    ])


# ------------------------------------------------------------------
# Sessions
# ------------------------------------------------------------------

# Reads in SQL (like the course list): one query with the course name and the
# message count instead of loading every message just to count them.
SESSIONS_SQL = text("""
    SELECT s.id, s.course_id, c.name AS course_name, s.title, s.created_at, s.updated_at,
           (SELECT count(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
    FROM chat_sessions s
    LEFT JOIN courses c ON c.id = s.course_id      -- LEFT: keep chats whose course was deleted
    WHERE s.user_id = :me
      AND (CAST(:course_id AS uuid) IS NULL OR s.course_id = CAST(:course_id AS uuid))
      AND (CAST(:session_id AS uuid) IS NULL OR s.id = CAST(:session_id AS uuid))
      -- The list hides chats with no messages (a first question that failed
      -- leaves an empty chat behind); asking for one by id still finds it.
      AND (CAST(:session_id AS uuid) IS NOT NULL
           OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id))
    ORDER BY s.updated_at DESC                      -- uses idx_chat_sessions_user_recent
    LIMIT :limit
""")

SOURCES_SQL = text("""
    SELECT ms.message_id, ms.rank AS n, ms.cited, ms.similarity_score AS similarity,
           dc.id AS chunk_id, dc.material_id, mat.title AS material_title, dc.page_number,
           dc.chunk_type, dc.source, dc.content
    FROM chat_messages cm
    JOIN message_sources ms  ON ms.message_id = cm.id
    JOIN document_chunks dc  ON dc.id = ms.chunk_id
    JOIN materials mat       ON mat.id = dc.material_id
    WHERE cm.session_id = :session_id
    ORDER BY ms.message_id, ms.rank
""")


def _summaries(db: Session, user: User, course_id=None, session_id=None, limit=100) -> list[ChatSessionSummary]:
    rows = db.execute(SESSIONS_SQL, {
        "me": user.id, "course_id": str(course_id) if course_id else None,
        "session_id": str(session_id) if session_id else None, "limit": limit,
    }).mappings().all()
    return [ChatSessionSummary(**r) for r in rows]


def get_owned_session_or_404(db: Session, session_id: UUID, user: User) -> ChatSession:
    # Someone else's chat (or a made-up id) -> 404, never 403: don't reveal it exists.
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return session


@router.post("/sessions", response_model=ChatSessionSummary, status_code=status.HTTP_201_CREATED)
def create_session(body: ChatSessionCreate, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    get_owned_course_or_404(db, body.course_id, current_user)
    session = ChatSession(user_id=current_user.id, course_id=body.course_id)
    db.add(session)
    db.commit()
    return _summaries(db, current_user, session_id=session.id)[0]


@router.get("/sessions", response_model=list[ChatSessionSummary])
def list_sessions(course_id: UUID | None = None, limit: int = Query(50, ge=1, le=200),
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _summaries(db, current_user, course_id=course_id, limit=limit)


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(session_id: UUID, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    get_owned_session_or_404(db, session_id, current_user)
    summary = _summaries(db, current_user, session_id=session_id)[0]
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    sources: dict[UUID, list[ChatSource]] = {}
    for r in db.execute(SOURCES_SQL, {"session_id": session_id}).mappings():
        row = dict(r)
        sources.setdefault(row.pop("message_id"), []).append(ChatSource(**row))
    return ChatSessionDetail(
        **summary.model_dump(),
        messages=[
            ChatMessageOut(id=m.id, role=m.role, content=m.content, created_at=m.created_at, status=m.status,
                           model=m.model, search_query=m.search_query, sources=sources.get(m.id, []))
            for m in messages
        ],
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: UUID, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    session = get_owned_session_or_404(db, session_id, current_user)
    db.delete(session)          # messages + sources go too (ON DELETE CASCADE)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------
# Asking a question
# ------------------------------------------------------------------

def load_history(db: Session, session_id: UUID) -> list[rag.Turn]:
    """The last few question+answer pairs, oldest first (for follow-ups)."""
    recent = (
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc()).limit(2 * rag.HISTORY_TURNS).all()
    )
    turns, question = [], None
    for m in reversed(recent):
        if m.role == "user":
            question = m.content
        elif question is not None:
            turns.append(rag.Turn(question=question, answer=m.content))
            question = None
    return turns


def save_exchange(session_id: UUID, set_title: bool, question: str, search_query: str | None,
                  answer: rag.Finished, passages: list[rag.Passage]) -> tuple[UUID, UUID]:
    """Question + answer + sources in ONE transaction: all saved or none."""
    with SessionLocal() as db:
        q = ChatMessage(session_id=session_id, role="user", content=question, search_query=search_query)
        db.add(q)
        db.flush()   # INSERT the question first: its clock_timestamp() is earlier
        a = ChatMessage(session_id=session_id, role="assistant", content=answer.text, status=answer.status,
                        model=answer.model, prompt_tokens=answer.prompt_tokens, output_tokens=answer.output_tokens)
        db.add(a)
        db.flush()
        # A file deleted while the answer was being written takes its passages
        # with it: only link passages that still exist (else the FOREIGN KEY
        # would reject the whole transaction and the answer would be lost).
        ids = [p.chunk_id for p in passages]
        still_there = set(db.scalars(select(DocumentChunk.id).where(DocumentChunk.id.in_(ids)))) if ids else set()
        cited = set(answer.cited)
        db.add_all(
            MessageSource(message_id=a.id, chunk_id=p.chunk_id, rank=p.n,
                          similarity_score=p.similarity, cited=p.n in cited)
            for p in passages if p.chunk_id in still_there
        )
        if set_title:
            title = question if len(question) <= TITLE_CHARS else question[: TITLE_CHARS - 1].rstrip() + "…"
            db.execute(update(ChatSession).where(ChatSession.id == session_id, ChatSession.title.is_(None))
                       .values(title=title))
        db.commit()
        return q.id, a.id


def _search(user: User, course_id: UUID, query: str):
    with SessionLocal() as db:
        return search_course(db, user, course_id, query, CHAT_PASSAGES)


def sse(event: str, data: dict) -> str:
    # The SSE wire format: "event:" line, "data:" line, blank line = end of event.
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _source_json(p: rag.Passage) -> dict:
    return {
        "n": p.n, "chunk_id": p.chunk_id, "material_id": p.material_id, "material_title": p.material_title,
        "page_number": p.page_number, "chunk_type": p.chunk_type, "source": p.source,
        "content": p.content, "similarity": p.similarity, "cited": False,
    }


def _error(reason: str, message: str, until: float | None = None) -> str:
    return sse("error", {"reason": reason, "message": message, "available_at": _utc(until)})


async def answer_events(user: User, course_id: UUID, session_id: UUID, set_title: bool,
                        question: str, history: list[rag.Turn]):
    """The SSE stream for one question. Every step's failure becomes an
    'error' event: once the stream has started, the HTTP status is already 200."""
    shown: list[str] = []
    model: str | None = None
    passages: list[rag.Passage] = []
    search_query: str | None = None
    done = False
    try:
        yield sse("status", {"step": "searching"})
        client = gemini_client()
        query = await rag.rewrite_question(client, rewrite_limiter, history, question)
        search_query = query if query != question else None
        result = await run_in_threadpool(_search, user, course_id, query)
        passages = rag.passages_from_hits(result.results)
        yield sse("sources", {"search_query": search_query, "mode": result.mode,
                              "passages": [_source_json(p) for p in passages]})

        finished: rag.Finished | None = None
        async for event in rag.stream_answer(client, answer_limiters, question, passages, history):
            if isinstance(event, rag.Delta):
                shown.append(event.text)
                model = event.model
                yield sse("delta", {"text": event.text})
            else:
                finished = event
        q_id, a_id = await run_in_threadpool(save_exchange, session_id, set_title, question, search_query,
                                             finished, passages)
        done = True
        yield sse("done", {
            "question_id": q_id, "message_id": a_id, "status": finished.status, "model": finished.model,
            "text": finished.text, "cited": finished.cited,
        })
    except (asyncio.CancelledError, GeneratorExit):
        # The browser went away: the student pressed Stop (or closed the tab).
        # Keep what they already saw. shield=True: this save must finish even
        # though the request is being cancelled around it.
        partial = "".join(shown).strip()
        if not partial and not done:
            # A dropped connection is otherwise completely silent in the log
            # (that's how the 30-second proxy cut-off hid at first).
            log.info("The browser left before the answer started (Stop, closed tab or lost connection); nothing saved")
        if partial and not done:
            stopped = rag.Finished(text=partial, status="stopped", model=model,
                                   cited=rag.cited_numbers(partial, len(passages)))
            with anyio.CancelScope(shield=True):
                try:
                    await run_in_threadpool(save_exchange, session_id, set_title, question, search_query,
                                            stopped, passages)
                    log.info("Answer stopped by the student; saved the %d characters shown", len(partial))
                except Exception:
                    log.exception("Couldn't save the stopped answer")
        raise
    except rag.ChatUnavailable as e:
        yield _error(e.reason, str(e), e.until)
    except GeminiConfigError as e:
        log.error("Chat can't reach Gemini: %s. Check GEMINI_API_KEY / CHAT_MODEL in backend/.env", e)
        yield _error("setup", "The chat has a setup problem on the server.")
    except QuotaExceeded:
        yield _error("busy", "Too many questions right now. Try again in a minute.")
    except GeminiError as e:
        log.warning("Answer failed: %s", e)
        yield _error("failed", "The answer was interrupted. Please ask again.")
    except Exception:
        log.exception("Chat error")
        yield _error("failed", "Something went wrong while answering. Please ask again.")


# ------------------------------------------------------------------
# Keep-alive: the connection must not go silent
# ------------------------------------------------------------------
# After the sources are sent, nothing flows until Gemini's first word, and
# Gemini can think (or hang) for 30+ s. Proxies close connections that stay
# silent too long: the Next.js /api proxy after 30 s (it cut answers off with
# "Something went wrong" and NO error in the backend log), nginx after 60 s by
# default. So whenever nothing has been sent for a few seconds, we send an SSE
# COMMENT: a line starting with ":" that every SSE reader ignores, but which
# the proxy counts as traffic.

KEEP_ALIVE_SECONDS = 10
KEEP_ALIVE = ": still working\n\n"


async def with_keep_alive(events, every: float = KEEP_ALIVE_SECONDS):
    """Pass on every event from `events`; if none comes within `every`
    seconds, send a keep-alive comment and keep waiting for the same event."""
    iterator = events.__aiter__()
    # The next event is fetched in its own task, so we can wait for it WITH a
    # timeout without cancelling it (a cancelled fetch would end the stream).
    pending = asyncio.ensure_future(iterator.__anext__())
    try:
        while True:
            finished, _ = await asyncio.wait({pending}, timeout=every)
            if not finished:
                yield KEEP_ALIVE
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                return
            yield event
            pending = asyncio.ensure_future(iterator.__anext__())
    finally:
        # The browser left (Stop / closed tab): stop the answer too. Cancelling
        # its task raises CancelledError inside answer_events, which saves the
        # part already shown. Wait for that (shielded: we're being cancelled).
        if not pending.done():
            pending.cancel()
            with anyio.CancelScope(shield=True):
                try:
                    await pending
                except BaseException:
                    pass
        else:
            with anyio.CancelScope(shield=True):
                await iterator.aclose()


SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",  # no proxy may store or compress-and-hold it
    "X-Accel-Buffering": "no",                  # nginx (deployment): pass each event on at once
}


@router.post("/sessions/{session_id}/messages")
async def ask(session_id: UUID, body: ChatQuestion, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    # Checks BEFORE streaming, so they are real HTTP errors (404/409/503).
    session = await run_in_threadpool(get_owned_session_or_404, db, session_id, current_user)
    if session.course_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This chat's course was deleted, so there's nothing to search. Start a new chat.")
    if not GEMINI_API_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The chat is switched off: no Gemini API key is set on the server.")
    history = await run_in_threadpool(load_history, db, session_id)
    return StreamingResponse(
        with_keep_alive(
            answer_events(current_user, session.course_id, session_id, session.title is None, body.question, history)
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
