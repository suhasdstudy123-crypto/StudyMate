"""
Chat router: conversational Q&A powered by RAG across uploaded study materials.

Endpoints:
  GET    /chat/sessions               list recent conversations
  POST   /chat/sessions               start a new conversation
  GET    /chat/sessions/{id}          get conversation history with sources
  DELETE /chat/sessions/{id}          delete conversation
  POST   /chat/sessions/{id}/messages post question, receive grounded answer with citations
  POST   /chat                        quick one-shot or continuation endpoint
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import (
    ChatMessage,
    ChatSession,
    Course,
    DocumentChunk,
    Material,
    MessageSource,
    User,
)
from backend.app.routers.courses import get_owned_course_or_404
from backend.app.schemas import (
    ChatMessageCreate,
    ChatMessageWithSourcesResponse,
    ChatSessionCreate,
    ChatSessionDetailResponse,
    ChatSessionResponse,
    QuickChatRequest,
    SourceCitationResponse,
)
from backend.app.services.rag import generate_rag_answer

log = logging.getLogger("studymate.chat")

router = APIRouter(prefix="/chat", tags=["Chat"])


def get_owned_session_or_404(
    db: Session, session_id: UUID, user: User
) -> ChatSession:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found",
        )
    return session


@router.get("/sessions", response_model=list[ChatSessionResponse])
def list_chat_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all chat sessions for the current student, sorted by recent activity."""
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    return sessions


@router.post(
    "/sessions",
    response_model=ChatSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_session(
    data: ChatSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a new conversation, optionally bound to a course."""
    if data.course_id is not None:
        get_owned_course_or_404(db, data.course_id, current_user)

    title = data.title.strip() if data.title else None
    session = ChatSession(
        user_id=current_user.id,
        course_id=data.course_id,
        title=title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=ChatSessionDetailResponse)
def get_chat_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve full conversation history including citations."""
    session = get_owned_session_or_404(db, session_id, current_user)

    course_name = None
    if session.course_id:
        course = db.query(Course.name).filter(Course.id == session.course_id).first()
        if course:
            course_name = course[0]

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    result_messages: list[ChatMessageWithSourcesResponse] = []
    for msg in messages:
        citations: list[SourceCitationResponse] = []
        if msg.role == "assistant":
            # Fetch message sources with chunk and material metadata
            source_rows = (
                db.query(
                    MessageSource.chunk_id,
                    MessageSource.rank,
                    MessageSource.similarity_score,
                    DocumentChunk.material_id,
                    DocumentChunk.page_number,
                    DocumentChunk.content,
                    DocumentChunk.chunk_type,
                    DocumentChunk.source,
                    Material.title.label("material_title"),
                )
                .join(DocumentChunk, DocumentChunk.id == MessageSource.chunk_id)
                .join(Material, Material.id == DocumentChunk.material_id)
                .filter(MessageSource.message_id == msg.id)
                .order_by(MessageSource.rank.asc())
                .all()
            )
            citations = [
                SourceCitationResponse(
                    chunk_id=r.chunk_id,
                    material_id=r.material_id,
                    material_title=r.material_title,
                    page_number=r.page_number,
                    content=r.content,
                    chunk_type=r.chunk_type or "text",
                    source=r.source or "pdf_text",
                    similarity=r.similarity_score,
                    rank=r.rank,
                )
                for r in source_rows
            ]
        result_messages.append(
            ChatMessageWithSourcesResponse(
                id=msg.id,
                role=msg.role,
                content=msg.content,
                created_at=msg.created_at,
                sources=citations,
            )
        )

    return ChatSessionDetailResponse(
        id=session.id,
        course_id=session.course_id,
        course_name=course_name,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=result_messages,
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a chat session and all its messages."""
    session = get_owned_session_or_404(db, session_id, current_user)
    msg_ids = [m[0] for m in db.query(ChatMessage.id).filter(ChatMessage.session_id == session.id).all()]
    if msg_ids:
        db.query(MessageSource).filter(MessageSource.message_id.in_(msg_ids)).delete(synchronize_session=False)
        db.query(ChatMessage).filter(ChatMessage.id.in_(msg_ids)).delete(synchronize_session=False)
    db.delete(session)
    db.commit()


@router.post(
    "/sessions/{session_id}/messages",
    response_model=ChatMessageWithSourcesResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_chat_message(
    session_id: UUID,
    data: ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Post a question to a chat session, retrieve relevant passages, and return the answer with citations."""
    session = get_owned_session_or_404(db, session_id, current_user)
    question = data.content.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Question cannot be blank",
        )

    # 1. Save user question
    user_msg = ChatMessage(
        session_id=session.id,
        role="user",
        content=question,
    )
    db.add(user_msg)

    # Update session title if not set
    if not session.title:
        title_snippet = question[:45].strip()
        if len(question) > 45:
            title_snippet += "..."
        session.title = title_snippet

    db.commit()

    # 2. Run RAG retrieval & answer generation
    rag_result = generate_rag_answer(
        db=db,
        user_id=current_user.id,
        question=question,
        course_id=session.course_id,
    )

    # 3. Save assistant response
    assistant_msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=rag_result.answer,
    )
    db.add(assistant_msg)
    db.flush()  # assign assistant_msg.id

    # 4. Save citation associations
    citations: list[SourceCitationResponse] = []
    for chunk in rag_result.sources:
        source_record = MessageSource(
            message_id=assistant_msg.id,
            chunk_id=chunk.chunk_id,
            rank=chunk.rank,
            similarity_score=chunk.similarity,
        )
        db.add(source_record)
        citations.append(
            SourceCitationResponse(
                chunk_id=chunk.chunk_id,
                material_id=chunk.material_id,
                material_title=chunk.material_title,
                page_number=chunk.page_number,
                content=chunk.content,
                chunk_type=chunk.chunk_type,
                source=chunk.source,
                similarity=chunk.similarity,
                rank=chunk.rank,
            )
        )

    db.commit()
    db.refresh(assistant_msg)

    return ChatMessageWithSourcesResponse(
        id=assistant_msg.id,
        role=assistant_msg.role,
        content=assistant_msg.content,
        created_at=assistant_msg.created_at,
        sources=citations,
    )


@router.post("", response_model=ChatMessageWithSourcesResponse)
def quick_chat(
    data: QuickChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Convenience endpoint: create or continue a conversation and ask a question in one request."""
    if data.session_id is not None:
        session = get_owned_session_or_404(db, data.session_id, current_user)
    else:
        if data.course_id is not None:
            get_owned_course_or_404(db, data.course_id, current_user)
        session = ChatSession(
            user_id=current_user.id,
            course_id=data.course_id,
            title=data.question[:45].strip(),
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    return send_chat_message(
        session_id=session.id,
        data=ChatMessageCreate(content=data.question),
        db=db,
        current_user=current_user,
    )
