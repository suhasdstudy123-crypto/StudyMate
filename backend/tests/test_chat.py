"""
Tests for Chat API endpoints, session lifecycle, message persistence, and authorization.
"""

import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.models import (
    ChatMessage,
    ChatSession,
    Course,
    MessageSource,
    User,
)
from backend.app.routers.chat import (
    create_chat_session,
    delete_chat_session,
    get_chat_session,
    list_chat_sessions,
    send_chat_message,
)
from backend.app.schemas import ChatMessageCreate, ChatSessionCreate


def test_chat_session_create_and_list(
    db_session: Session, sample_user: User, sample_course: Course
):
    created = create_chat_session(
        data=ChatSessionCreate(course_id=sample_course.id, title="DBMS Revision"),
        db=db_session,
        current_user=sample_user,
    )
    assert created.id is not None
    assert created.course_id == sample_course.id
    assert created.title == "DBMS Revision"

    sessions = list_chat_sessions(db=db_session, current_user=sample_user)
    assert len(sessions) >= 1
    assert any(s.id == created.id for s in sessions)


def test_chat_message_and_source_persistence(
    db_session: Session, sample_user: User, sample_course: Course, sample_material
):
    material, page, chunks = sample_material

    # Create session
    session = create_chat_session(
        data=ChatSessionCreate(course_id=sample_course.id),
        db=db_session,
        current_user=sample_user,
    )

    # Send question
    response = send_chat_message(
        session_id=session.id,
        data=ChatMessageCreate(content="Explain 3NF rules"),
        db=db_session,
        current_user=sample_user,
    )

    assert response.role == "assistant"
    assert response.content is not None
    assert len(response.sources) == 1
    assert response.sources[0].chunk_id == chunks[0].id
    assert response.sources[0].page_number == 1
    assert response.sources[0].material_title == material.title

    # Verify database persistence
    db_sources = (
        db_session.query(MessageSource)
        .filter(MessageSource.message_id == response.id)
        .all()
    )
    assert len(db_sources) == 1
    assert db_sources[0].chunk_id == chunks[0].id

    # Verify session detail retrieval
    detail = get_chat_session(
        session_id=session.id, db=db_session, current_user=sample_user
    )
    assert len(detail.messages) == 2  # user + assistant
    assert detail.messages[0].role == "user"
    assert detail.messages[0].content == "Explain 3NF rules"
    assert detail.messages[1].role == "assistant"
    assert len(detail.messages[1].sources) == 1


def test_chat_cross_user_forbidden(
    db_session: Session, sample_user: User, other_user: User
):
    session = create_chat_session(
        data=ChatSessionCreate(title="Alice's Private Session"),
        db=db_session,
        current_user=sample_user,
    )

    # Bob attempts to read Alice's session
    with pytest.raises(HTTPException) as exc_info:
        get_chat_session(session_id=session.id, db=db_session, current_user=other_user)
    assert exc_info.value.status_code == 404

    # Bob attempts to send a message to Alice's session
    with pytest.raises(HTTPException) as exc_info:
        send_chat_message(
            session_id=session.id,
            data=ChatMessageCreate(content="Unauthorized access"),
            db=db_session,
            current_user=other_user,
        )
    assert exc_info.value.status_code == 404


def test_delete_chat_session_cascades(
    db_session: Session, sample_user: User, sample_course: Course, sample_material
):
    session = create_chat_session(
        data=ChatSessionCreate(course_id=sample_course.id),
        db=db_session,
        current_user=sample_user,
    )

    send_chat_message(
        session_id=session.id,
        data=ChatMessageCreate(content="Test message for deletion"),
        db=db_session,
        current_user=sample_user,
    )

    # Delete session
    delete_chat_session(session_id=session.id, db=db_session, current_user=sample_user)

    # Verify cascade deletion
    leftover_messages = (
        db_session.query(ChatMessage).filter(ChatMessage.session_id == session.id).all()
    )
    assert len(leftover_messages) == 0
