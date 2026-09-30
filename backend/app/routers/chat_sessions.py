from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import ChatSession, Course, User
from backend.app.schemas import ChatSessionCreate, ChatSessionResponse


router = APIRouter(
    prefix="/chat/sessions",
    tags=["Chat Sessions"],
)


# =========================================================
# CREATE CHAT SESSION
# POST /chat/sessions
# =========================================================
@router.post(
    "",
    response_model=ChatSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_session(
    session_data: ChatSessionCreate,
    db: Session = Depends(get_db),
):
    # Check whether the user exists
    user = (
        db.query(User)
        .filter(User.id == session_data.user_id)
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # If a course was supplied, verify that it exists
    if session_data.course_id is not None:
        course = (
            db.query(Course)
            .filter(Course.id == session_data.course_id)
            .first()
        )

        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )

        # Make sure the course belongs to the user
        if course.user_id != session_data.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Course does not belong to user",
            )

    new_session = ChatSession(
        user_id=session_data.user_id,
        course_id=session_data.course_id,
        title=session_data.title,
    )

    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    return new_session


# =========================================================
# GET CHAT SESSION
# GET /chat/sessions/{session_id}
# =========================================================
@router.get(
    "/{session_id}",
    response_model=ChatSessionResponse,
)
def get_chat_session(
    session_id: UUID,
    db: Session = Depends(get_db),
):
    chat_session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id)
        .first()
    )

    if not chat_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found",
        )

    return chat_session


# =========================================================
# GET ALL CHAT SESSIONS FOR A USER
# GET /chat/sessions/user/{user_id}
# =========================================================
@router.get(
    "/user/{user_id}",
    response_model=list[ChatSessionResponse],
)
def get_user_chat_sessions(
    user_id: UUID,
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at)
        .all()
    )

    return sessions


# =========================================================
# DELETE CHAT SESSION
# DELETE /chat/sessions/{session_id}
# =========================================================
@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_chat_session(
    session_id: UUID,
    db: Session = Depends(get_db),
):
    chat_session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id)
        .first()
    )

    if not chat_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found",
        )

    db.delete(chat_session)
    db.commit()

    return None