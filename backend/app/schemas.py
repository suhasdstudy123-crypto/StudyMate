from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    name: str
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    email: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

class CourseCreate(BaseModel):
    user_id: UUID
    name: str
    code: str | None = None
    description: str | None = None


class CourseUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None


class CourseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    code: str | None = None
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

class MaterialCreate(BaseModel):
    course_id: UUID
    title: str
    file_name: str
    file_path: str
    file_type: str | None = None
    file_size: int | None = None


class MaterialResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    course_id: UUID
    title: str
    file_name: str
    file_path: str
    file_type: str | None = None
    file_size: int | None = None
    processing_status: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

class ChatSessionCreate(BaseModel):
    user_id: UUID
    course_id: UUID | None = None
    title: str | None = None


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    course_id: UUID | None = None
    title: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

class ChatMessageCreate(BaseModel):
    session_id: UUID
    role: str
    content: str


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    role: str
    content: str
    created_at: datetime | None = None

class MessageSourceCreate(BaseModel):
    message_id: UUID
    chunk_id: UUID
    similarity_score: float | None = None
    source_order: int | None = None


class MessageSourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    chunk_id: UUID
    similarity_score: float | None = None
    source_order: int | None = None

class MaterialUpdate(BaseModel):
    course_id: UUID | None = None
    title: str | None = None
    file_name: str | None = None
    file_path: str | None = None
    file_type: str | None = None
    file_size: int | None = None