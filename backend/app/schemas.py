"""
Pydantic schemas: the shapes of JSON going IN to and OUT of the API.

Models (models.py) describe database rows.
Schemas (this file) describe what the API accepts and returns.
Keeping them separate is a security boundary: e.g. UserResponse has no
password_hash field, so the hash can never leak into a response even if
a route returns a full User object.

Pydantic validates incoming JSON automatically: a request that breaks
these rules gets a 422 error before our route code even runs.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMSchema(BaseModel):
    # from_attributes=True lets Pydantic read SQLAlchemy objects
    # (user.name) and not only dicts (user["name"]).
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------
# Users (registration/login schemas arrive with auth in Stage 3)
# ------------------------------------------------------------------

class UserResponse(ORMSchema):
    id: UUID
    name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime


# ------------------------------------------------------------------
# Courses
# ------------------------------------------------------------------

class CourseCreate(BaseModel):
    # NOTE: user_id is still sent by the client until Stage 3.
    # After auth, it comes from the logged-in user's token instead.
    user_id: UUID
    name: str = Field(min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)


class CourseResponse(ORMSchema):
    id: UUID
    user_id: UUID
    name: str
    code: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------
# Materials (created by the upload endpoint in Stage 5)
# ------------------------------------------------------------------

class MaterialResponse(ORMSchema):
    id: UUID
    course_id: UUID
    title: str
    original_filename: str
    mime_type: str
    file_size: int
    page_count: int | None
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    # stored_path and content_hash are internal details: not exposed.


# ------------------------------------------------------------------
# Chat (the RAG chat endpoint arrives in Stage 7)
# ------------------------------------------------------------------

class ChatSessionResponse(ORMSchema):
    id: UUID
    course_id: UUID | None
    title: str | None
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(ORMSchema):
    id: UUID
    role: str
    content: str
    created_at: datetime
