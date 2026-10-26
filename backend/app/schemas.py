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
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORMSchema(BaseModel):
    # from_attributes=True lets Pydantic read SQLAlchemy objects
    # (user.name) and not only dicts (user["name"]).
    model_config = ConfigDict(from_attributes=True)


def _normalize_email(value: str) -> str:
    # Matches the users_email_lowercase CHECK in schema.sql.
    return value.strip().lower()


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

class RegisterRequest(BaseModel):
    # There is deliberately NO "role" field: a client must never be able
    # to register itself as admin. Every new account is a student.
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr  # format checked by the email-validator package
    # 8 = minimum sensible length; 128 = cap so nobody can send a 10 MB
    # "password" and make the server spend seconds hashing it.
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value

    # The password is intentionally NOT stripped: "pass word " is
    # exactly what the user typed and must be hashed as-is.
    normalize_email = field_validator("email")(_normalize_email)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    normalize_email = field_validator("email")(_normalize_email)


# ------------------------------------------------------------------
# Users
# ------------------------------------------------------------------

class UserResponse(ORMSchema):
    id: UUID
    name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    # Returned by register/login. The browser ignores access_token
    # (it uses the httpOnly cookie); API clients and /docs use it.
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ------------------------------------------------------------------
# Courses
# ------------------------------------------------------------------

def _clean_optional(value: str | None) -> str | None:
    # "  " or "" for an optional field means "no value": store NULL,
    # not an empty string, so the UI can simply check "has a code?".
    if value is None:
        return None
    value = value.strip()
    return value or None


def _clean_name(value: str) -> str:
    # Runs BEFORE the length check (mode="before" below), so "   " becomes ""
    # and fails min_length=1 with a clear 422, instead of reaching the
    # database CHECK and coming back as a confusing error.
    return value.strip() if isinstance(value, str) else value


class CourseCreate(BaseModel):
    # No user_id: the owner is always the logged-in user (from the token).
    name: str = Field(min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)

    clean_name = field_validator("name", mode="before")(_clean_name)
    clean_optional = field_validator("code", "description")(_clean_optional)


class CourseUpdate(BaseModel):
    # PATCH = partial update: send only the fields you want to change.
    # name may be left out, but it can't be set to null (a course always
    # has a name), so its type is str, not str | None.
    name: str = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)

    clean_name = field_validator("name", mode="before")(_clean_name)
    clean_optional = field_validator("code", "description")(_clean_optional)


class CourseSummary(BaseModel):
    # One course card: the course plus live counts from the
    # course_overview VIEW in schema.sql (one row per course).
    id: UUID
    name: str
    code: str | None
    description: str | None
    created_at: datetime
    material_count: int
    ready_material_count: int
    chunk_count: int
    last_activity: datetime


# ------------------------------------------------------------------
# Materials (Stage 5): uploaded PDFs, their pages and chunks
# ------------------------------------------------------------------

class MaterialSummary(BaseModel):
    # One file on the course page, read from the material_overview VIEW.
    # stored_path and content_hash are internal details: never sent out.
    id: UUID
    course_id: UUID
    title: str
    original_filename: str
    file_size: int
    page_count: int | None
    pages_processed: int          # progress: "page 12 of 40"
    status: str                   # pending | processing | ready | failed
    error_message: str | None
    chunk_count: int
    table_count: int
    vision_page_count: int        # pages with pictures (found by the text pass)
    created_at: datetime
    updated_at: datetime
    processing_mode: str          # smart | thorough
    vision_waiting_count: int     # pages queued for / being read by the image reader
    vision_done_count: int
    vision_failed_count: int


class MaterialUpdate(BaseModel):
    # Rename a file ("UE24CS351A da2816aa-..." -> "Unit 3 - Transactions").
    title: str = Field(min_length=1, max_length=255)

    clean_title = field_validator("title", mode="before")(_clean_name)


class PageSummary(ORMSchema):
    page_number: int
    char_count: int
    table_count: int
    image_count: int
    drawing_count: int
    math_symbol_count: int
    needs_vision: bool
    vision_status: str            # none | pending | processing | done | failed
    vision_error: str | None = None  # why the image reader gave up (when failed)
    has_image: bool = False       # a page picture is saved (GET .../pages/{n}/image)
    chunk_count: int = 0


class ChunkResponse(ORMSchema):
    id: UUID
    chunk_index: int
    page_number: int
    chunk_type: str               # text | table | diagram
    source: str                   # pdf_text | vision
    content: str
    token_count: int | None


class PageDetail(BaseModel):
    page: PageSummary
    chunks: list[ChunkResponse]


class VisionStatus(BaseModel):
    # GET /vision/status: is the image reader (Gemini) working right now?
    status: Literal["ok", "paused", "off", "error"]
    message: str | None
    paused_until: datetime | None   # when the daily quota resets (UTC); the browser shows local time


# ------------------------------------------------------------------
# Search (Stage 6): GET /courses/{id}/search?q=...
# ------------------------------------------------------------------

class SearchHit(BaseModel):
    chunk_id: UUID
    material_id: UUID
    material_title: str
    page_number: int
    chunk_type: str                 # text | table | diagram
    source: str                     # pdf_text | vision ("Read from an image")
    content: str
    score: float                    # Reciprocal Rank Fusion score: higher = better
    meaning_rank: int | None        # position in the meaning (vector) list, None = not in it
    keyword_rank: int | None        # position in the keyword list, None = not in it
    similarity: float | None        # cosine similarity 0..1 to the question


class SearchResponse(BaseModel):
    query: str
    # "hybrid" = meaning + keywords; "keywords" = the embedding model isn't
    # ready (still loading / switched off), so only keyword search ran.
    mode: Literal["hybrid", "keywords"]
    took_ms: int
    results: list[SearchHit]


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
