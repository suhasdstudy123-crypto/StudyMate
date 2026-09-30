from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import ChatMessage, ChatSession
from backend.app.schemas import ChatMessageCreate, ChatMessageResponse


router = APIRouter(
    prefix="/chat/messages",
    tags=["Chat Messages"],
)


# =========================================================
# CREATE CHAT MESSAGE
# POST /chat/messages
# =========================================================
@router.post(
    "",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_message(
    message_data: ChatMessageCreate,
    db: Session = Depends(get_db),
):
    # Check whether the chat session exists
    chat_session = (
        db.query(ChatSession)
        .filter(ChatSession.id == message_data.session_id)
        .first()
    )

    if not chat_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found",
        )

    # Validate message role
    if message_data.role not in {"user", "assistant", "system"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid message role",
        )

    new_message = ChatMessage(
        session_id=message_data.session_id,
        role=message_data.role,
        content=message_data.content,
    )

    db.add(new_message)

    # Update the chat session timestamp
    chat_session.updated_at = new_message.created_at

    db.commit()
    db.refresh(new_message)

    return new_message


# =========================================================
# GET CHAT MESSAGE
# GET /chat/messages/{message_id}
# =========================================================
@router.get(
    "/{message_id}",
    response_model=ChatMessageResponse,
)
def get_chat_message(
    message_id: UUID,
    db: Session = Depends(get_db),
):
    message = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id)
        .first()
    )

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat message not found",
        )

    return message


# =========================================================
# GET ALL MESSAGES IN A SESSION
# GET /chat/messages/session/{session_id}
# =========================================================
@router.get(
    "/session/{session_id}",
    response_model=list[ChatMessageResponse],
)
def get_session_messages(
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

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .all()
    )

    return messages


# =========================================================
# DELETE CHAT MESSAGE
# DELETE /chat/messages/{message_id}
# =========================================================
@router.delete(
    "/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_chat_message(
    message_id: UUID,
    db: Session = Depends(get_db),
):
    message = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id)
        .first()
    )

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat message not found",
        )

    db.delete(message)
    db.commit()

    return None