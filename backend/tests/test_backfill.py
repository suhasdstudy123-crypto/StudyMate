"""
Tests for embedding backfill in backend/app/processing/backfill_embeddings.py.
"""

import uuid
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.app.models import Course, DocumentChunk, DocumentPage, Material, User
from backend.app.processing.backfill_embeddings import backfill_missing_embeddings


def test_backfill_missing_embeddings(
    db_session: Session, sample_user: User, sample_course: Course, monkeypatch
):
    # Material with chunks lacking embeddings
    m = Material(
        id=uuid.uuid4(),
        course_id=sample_course.id,
        title="Unembedded Lecture",
        original_filename="unembedded.pdf",
        stored_path="test/unembedded.pdf",
        mime_type="application/pdf",
        file_size=5000,
        content_hash="c" * 64,
        status="ready",
    )
    db_session.add(m)
    p = DocumentPage(material_id=m.id, page_number=1)
    db_session.add(p)

    c1 = DocumentChunk(
        id=uuid.uuid4(),
        material_id=m.id,
        chunk_index=0,
        page_number=1,
        content="Chunk 1 missing embedding",
        embedding=None,
    )
    c2 = DocumentChunk(
        id=uuid.uuid4(),
        material_id=m.id,
        chunk_index=1,
        page_number=1,
        content="Chunk 2 missing embedding",
        embedding=None,
    )
    db_session.add(c1)
    db_session.add(c2)
    db_session.commit()

    # Monkeypatch SessionLocal to return db_session
    class MockSessionContext:
        def __enter__(self):
            return db_session
        def __exit__(self, *args):
            pass

    import backend.app.processing.backfill_embeddings as bf
    monkeypatch.setattr(bf, "SessionLocal", lambda: MockSessionContext())

    # Run backfill
    updated_count = backfill_missing_embeddings(batch_size=10)
    assert updated_count == 2

    # Verify embeddings were populated
    db_session.expire_all()
    reloaded_c1 = db_session.get(DocumentChunk, c1.id)
    assert reloaded_c1.embedding is not None
    assert len(reloaded_c1.embedding) == 384

    # Idempotent second run
    second_run = backfill_missing_embeddings(batch_size=10)
    assert second_run == 0
