from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import ChatMessage, DocumentChunk, MessageSource
from backend.app.schemas import MessageSourceCreate, MessageSourceResponse

router = APIRouter(
    prefix="/message-sources",
    tags=["Message Sources"],
)


@router.post(
    "",
    response_model=MessageSourceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_message_source(
    source_data: MessageSourceCreate,
    db: Session = Depends(get_db),
):
    message = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == source_data.message_id)
        .first()
    )

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat message not found",
        )

    chunk = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.id == source_data.chunk_id)
        .first()
    )

    if not chunk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document chunk not found",
        )

    existing_source = (
        db.query(MessageSource)
        .filter(
            MessageSource.message_id == source_data.message_id,
            MessageSource.chunk_id == source_data.chunk_id,
        )
        .first()
    )

    if existing_source:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Message source already exists",
        )

    source = MessageSource(
        message_id=source_data.message_id,
        chunk_id=source_data.chunk_id,
        similarity_score=source_data.similarity_score,
        source_order=source_data.source_order,
    )

    db.add(source)
    db.commit()
    db.refresh(source)

    return source


@router.get(
    "/{source_id}",
    response_model=MessageSourceResponse,
)
def get_message_source(
    source_id: UUID,
    db: Session = Depends(get_db),
):
    source = (
        db.query(MessageSource)
        .filter(MessageSource.id == source_id)
        .first()
    )

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message source not found",
        )

    return source


@router.get(
    "/message/{message_id}",
    response_model=list[MessageSourceResponse],
)
def get_message_sources(
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

    sources = (
        db.query(MessageSource)
        .filter(MessageSource.message_id == message_id)
        .order_by(MessageSource.source_order)
        .all()
    )

    return sources


@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_message_source(
    source_id: UUID,
    db: Session = Depends(get_db),
):
    source = (
        db.query(MessageSource)
        .filter(MessageSource.id == source_id)
        .first()
    )

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message source not found",
        )

    db.delete(source)
    db.commit()

    return None