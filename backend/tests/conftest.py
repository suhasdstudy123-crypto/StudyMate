"""
Pytest configuration, fixtures, and database setup for StudyMate backend tests.
"""

import os
import sys
import types
import uuid
from typing import Generator
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import UserDefinedType
from sqlalchemy.ext.compiler import compiles

# Set test environment variables before importing config
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-validation"
os.environ["EMBEDDING_DEVICE"] = "cpu"

import json
import sqlite3
sqlite3.register_adapter(uuid.UUID, lambda u: u.hex)
sqlite3.register_adapter(list, lambda l: json.dumps(l))

# Register pgvector shim if pgvector is not installed
if "pgvector" not in sys.modules:
    try:
        import pgvector.sqlalchemy
    except ImportError:
        class FakeVector(UserDefinedType):
            cache_ok = True

            def __init__(self, dim=384):
                self.dim = dim

            def get_col_spec(self, **kw):
                return f"VECTOR({self.dim})"

            def bind_processor(self, dialect):
                def process(value):
                    if value is None:
                        return None
                    if isinstance(value, (list, tuple)):
                        import json
                        return json.dumps(list(value))
                    return str(value)
                return process

            def result_processor(self, dialect, coltype):
                def process(value):
                    if value is None:
                        return None
                    if isinstance(value, str):
                        import json
                        try:
                            return json.loads(value)
                        except Exception:
                            return None
                    return value
                return process

        pgvector_mod = types.ModuleType("pgvector")
        pgvector_sa = types.ModuleType("pgvector.sqlalchemy")
        pgvector_sa.Vector = FakeVector
        pgvector_mod.sqlalchemy = pgvector_sa
        sys.modules["pgvector"] = pgvector_mod
        sys.modules["pgvector.sqlalchemy"] = pgvector_sa

# Register email_validator shim if not installed
import importlib.metadata
_orig_version = importlib.metadata.version
def _mock_version(name):
    if name == "email-validator":
        return "2.1.0"
    return _orig_version(name)
importlib.metadata.version = _mock_version

if "email_validator" not in sys.modules:
    try:
        import email_validator
    except ImportError:
        ev_mod = types.ModuleType("email_validator")
        def validate_email(email, **kwargs):
            return types.SimpleNamespace(normalized=str(email).strip().lower(), email=str(email).strip().lower())
        ev_mod.validate_email = validate_email
        ev_mod.EmailNotValidError = type("EmailNotValidError", (ValueError,), {})
        sys.modules["email_validator"] = ev_mod

# Register argon2 shim if argon2 is not installed
if "argon2" not in sys.modules:
    try:
        import argon2
    except ImportError:
        argon2_mod = types.ModuleType("argon2")
        class PasswordHasher:
            def hash(self, password):
                return f"$argon2id$mock${password}"
            def verify(self, hash_str, password):
                return True
        class ArgonExceptions(types.ModuleType):
            VerifyMismatchError = type("VerifyMismatchError", (Exception,), {})
            VerificationError = type("VerificationError", (Exception,), {})
            InvalidHashError = type("InvalidHashError", (Exception,), {})
        argon2_mod.PasswordHasher = PasswordHasher
        argon2_mod.exceptions = ArgonExceptions("argon2.exceptions")
        sys.modules["argon2"] = argon2_mod
        sys.modules["argon2.exceptions"] = argon2_mod.exceptions
if "fastapi" not in sys.modules:
    try:
        import fastapi
    except ImportError:
        fastapi_mod = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code: int, detail: str = ""):
                self.status_code = status_code
                self.detail = detail
                super().__init__(detail)

        class APIRouter:
            def __init__(self, *args, **kwargs):
                pass
            def get(self, *args, **kwargs):
                return lambda fn: fn
            def post(self, *args, **kwargs):
                return lambda fn: fn
            def delete(self, *args, **kwargs):
                return lambda fn: fn
            def patch(self, *args, **kwargs):
                return lambda fn: fn

        status_mod = types.SimpleNamespace(
            HTTP_200_OK=200,
            HTTP_201_CREATED=201,
            HTTP_202_ACCEPTED=202,
            HTTP_204_NO_CONTENT=204,
            HTTP_404_NOT_FOUND=404,
            HTTP_409_CONFLICT=409,
            HTTP_422_UNPROCESSABLE_CONTENT=422,
        )

        fastapi_mod.HTTPException = HTTPException
        fastapi_mod.APIRouter = APIRouter
        fastapi_mod.Depends = lambda x: x
        fastapi_mod.Request = types.SimpleNamespace
        fastapi_mod.status = status_mod

        security_mod = types.ModuleType("fastapi.security")
        class HTTPBearer:
            def __init__(self, *args, **kwargs):
                pass
        class HTTPAuthorizationCredentials:
            credentials = "mock_token"
        security_mod.HTTPBearer = HTTPBearer
        security_mod.HTTPAuthorizationCredentials = HTTPAuthorizationCredentials
        fastapi_mod.security = security_mod
        sys.modules["fastapi.security"] = security_mod
        sys.modules["fastapi"] = fastapi_mod

# Compile PostgreSQL-specific types for SQLite test runner
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import TSVECTOR

@compiles(Vector, "sqlite")
def compile_vector_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(TSVECTOR, "sqlite")
def compile_tsvector_sqlite(type_, compiler, **kw):
    return "TEXT"


from backend.app.models import (
    Base,
    ChatMessage,
    ChatSession,
    Course,
    DocumentChunk,
    DocumentPage,
    Material,
    MessageSource,
    User,
)
from backend.app.services.embeddings import set_embedding_model
from backend.app.services.llm import MockLLM, set_llm


class DeterministicEmbeddingModel:
    def encode(self, texts, **kwargs):
        import numpy as np

        def _vec(t):
            # Deterministic pseudo-embedding based on hash of string
            h = abs(hash(t)) % 10000
            base = np.zeros(384, dtype=np.float32)
            base[0] = (h % 100) / 100.0
            base[1] = 1.0
            norm = np.linalg.norm(base)
            return (base / norm) if norm > 0 else base

        if isinstance(texts, str):
            return _vec(texts)
        return [_vec(t) for t in texts]


@pytest.fixture(scope="session", autouse=True)
def setup_test_services():
    set_embedding_model(DeterministicEmbeddingModel())
    set_llm(MockLLM())


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = sa.create_engine("sqlite:///:memory:")

    @sa.event.listens_for(engine, "connect")
    def setup_sqlite(dbapi_connection, connection_record):
        dbapi_connection.create_function("gen_random_uuid", 0, lambda: str(uuid.uuid4()))
        dbapi_connection.create_function("to_tsvector", 2, lambda cfg, txt: str(txt or ""), deterministic=True)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(sa.text("""
            CREATE VIEW IF NOT EXISTS course_overview AS
            SELECT
                c.id,
                c.user_id,
                c.name,
                c.code,
                c.description,
                c.created_at,
                COUNT(DISTINCT m.id) AS material_count,
                COUNT(DISTINCT CASE WHEN m.status = 'ready' THEN m.id END) AS ready_material_count,
                COUNT(dc.id) AS chunk_count,
                c.updated_at AS last_activity
            FROM courses c
            LEFT JOIN materials m ON m.course_id = c.id
            LEFT JOIN document_chunks dc ON dc.material_id = m.id
            GROUP BY c.id
        """))
        conn.execute(sa.text("""
            CREATE VIEW IF NOT EXISTS material_overview AS
            SELECT
                m.id,
                m.course_id,
                c.user_id,
                m.title,
                m.original_filename,
                m.file_size,
                m.page_count,
                m.pages_processed,
                m.status,
                m.error_message,
                m.created_at,
                m.updated_at,
                0 AS chunk_count,
                0 AS table_count,
                0 AS vision_page_count,
                m.processing_mode,
                0 AS vision_waiting_count,
                0 AS vision_done_count,
                0 AS vision_failed_count
            FROM materials m
            JOIN courses c ON c.id = m.course_id
        """))
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture
def sample_user(db_session: Session) -> User:
    u = User(
        id=uuid.uuid4(),
        name="Alice Student",
        email="alice@university.edu",
        password_hash="argon2id$mockhash",
        role="student",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def other_user(db_session: Session) -> User:
    u = User(
        id=uuid.uuid4(),
        name="Bob Hacker",
        email="bob@university.edu",
        password_hash="argon2id$mockhash",
        role="student",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def sample_course(db_session: Session, sample_user: User) -> Course:
    c = Course(
        id=uuid.uuid4(),
        user_id=sample_user.id,
        name="Database Management Systems",
        code="CS351",
        description="Core DBMS course covering 3NF, BCNF, ACID, and transactions.",
    )
    db_session.add(c)
    db_session.commit()
    return c


@pytest.fixture
def sample_material(
    db_session: Session, sample_course: Course
) -> tuple[Material, DocumentPage, list[DocumentChunk]]:
    m = Material(
        id=uuid.uuid4(),
        course_id=sample_course.id,
        title="Unit 3 - Normalization Notes",
        original_filename="unit3_normalization.pdf",
        stored_path=f"{sample_course.user_id}/sample.pdf",
        mime_type="application/pdf",
        file_size=102400,
        content_hash="a" * 64,
        page_count=2,
        pages_processed=2,
        status="ready",
        processing_mode="smart",
    )
    db_session.add(m)

    p1 = DocumentPage(
        material_id=m.id,
        page_number=1,
        char_count=500,
        needs_vision=False,
        vision_status="none",
    )
    db_session.add(p1)

    import numpy as np

    v1 = np.zeros(384, dtype=np.float32)
    v1[0] = 0.9
    v1[1] = 0.1
    v1 /= np.linalg.norm(v1)

    c1 = DocumentChunk(
        id=uuid.uuid4(),
        material_id=m.id,
        chunk_index=0,
        page_number=1,
        content="Third Normal Form (3NF) eliminates transitive dependency: every non-key attribute must depend directly on the primary key.",
        chunk_type="text",
        source="pdf_text",
        embedding=v1.tolist(),
    )
    db_session.add(c1)
    db_session.commit()

    return m, p1, [c1]
