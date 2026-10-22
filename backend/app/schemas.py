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
