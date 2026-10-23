"""
SQLAlchemy ORM models: one Python class per table in database/schema.sql.

The ORM lets the backend work with Python objects (User, Course, ...)
instead of writing SQL strings by hand. SQLAlchemy turns
    db.query(Course).filter(Course.user_id == uid).all()
into
    SELECT ... FROM courses WHERE user_id = %(uid)s

IMPORTANT: database/schema.sql is the single source of truth for the
database structure (constraints, triggers, views, functions live there).
These classes only MIRROR the tables so Python can read/write rows.
We never call Base.metadata.create_all(), the schema is created by psql.
"""

from datetime import datetime
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    FetchedValue,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Must match VECTOR(384) in schema.sql and the embedding model's output size.
EMBEDDING_DIM = 384


class Base(DeclarativeBase):
    pass


# ------------------------------------------------------------------
# Reusable column helpers (same pattern on every table)
# ------------------------------------------------------------------

def uuid_pk() -> Mapped[UUID]:
    # The database generates the id (DEFAULT gen_random_uuid()).
    return mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


def created_at_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def updated_at_col() -> Mapped[datetime]:
    # server_onupdate=FetchedValue() tells SQLAlchemy "the database changes
    # this column on UPDATE" (our set_updated_at trigger), so it re-reads
    # the new value instead of trusting a stale one in Python.
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        server_onupdate=FetchedValue(),
    )


# ------------------------------------------------------------------
# Tables
# ------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'student'")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    # passive_deletes=True: let PostgreSQL's ON DELETE CASCADE do the
    # deleting, instead of SQLAlchemy loading every child row first.
    courses: Mapped[list["Course"]] = relationship(
        back_populates="user", passive_deletes=True
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(
        back_populates="user", passive_deletes=True
    )


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    user: Mapped["User"] = relationship(back_populates="courses")
    materials: Mapped[list["Material"]] = relationship(
        back_populates="course", passive_deletes=True
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(
        back_populates="course", passive_deletes=True
    )


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[UUID] = uuid_pk()
    course_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    pages_processed: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'pending'")
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    # 'smart' = only pages with pictures go to the image reader; 'thorough' = all (migration 003)
    processing_mode: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'smart'")
    )

    course: Mapped["Course"] = relationship(back_populates="materials")
    pages: Mapped[list["DocumentPage"]] = relationship(
        back_populates="material", passive_deletes=True
    )
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="material", passive_deletes=True
    )


class DocumentPage(Base):
    # One row per PDF page (migration 002). Composite primary key:
    # (material_id, page_number) together identify a page.
    __tablename__ = "document_pages"

    material_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        primary_key=True,
    )
    page_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    table_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    image_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    drawing_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    math_symbol_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    needs_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = created_at_col()
    # Image reading of this page (migration 003): none | pending | processing | done | failed
    vision_status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'none'")
    )
    vision_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    vision_error: Mapped[str | None] = mapped_column(Text)
    vision_model: Mapped[str | None] = mapped_column(String(100))
    image_path: Mapped[str | None] = mapped_column(Text)  # relative, like materials.stored_path

    material: Mapped["Material"] = relationship(back_populates="pages")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[UUID] = uuid_pk()
    material_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer)
    chunk_type: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'text'")
    )
    # pgvector's SQLAlchemy type: Python list[float] <-> PostgreSQL VECTOR(384)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    # Generated by PostgreSQL from `content`; Computed() tells SQLAlchemy
    # never to write to it.
    content_tsv = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', content)", persisted=True)
    )
    created_at: Mapped[datetime] = created_at_col()
    # HOW it was read: 'pdf_text' (exact) or 'vision' (written by the image reader)
    source: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'pdf_text'")
    )

    material: Mapped["Material"] = relationship(back_populates="chunks")

    # The composite foreign key (material_id, page_number) -> document_pages.
    __table_args__ = (
        ForeignKeyConstraint(
            ["material_id", "page_number"],
            ["document_pages.material_id", "document_pages.page_number"],
            ondelete="CASCADE",
        ),
    )


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="SET NULL"),
    )
    title: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    user: Mapped["User"] = relationship(back_populates="chat_sessions")
    course: Mapped["Course | None"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session",
        passive_deletes=True,
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[UUID] = uuid_pk()
    session_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
    sources: Mapped[list["MessageSource"]] = relationship(
        back_populates="message",
        passive_deletes=True,
        order_by="MessageSource.rank",
    )


class MessageSource(Base):
    __tablename__ = "message_sources"

    # Composite primary key: the PAIR identifies a row.
    message_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    chunk_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("document_chunks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rank: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    similarity_score: Mapped[float | None] = mapped_column(Float)

    message: Mapped["ChatMessage"] = relationship(back_populates="sources")
    chunk: Mapped["DocumentChunk"] = relationship()
