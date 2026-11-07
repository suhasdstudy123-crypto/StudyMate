"""
Tests for vector retrieval service and isolation in backend/app/services/retrieval.py.
"""

import uuid
import numpy as np
import pytest
from sqlalchemy.orm import Session

from backend.app.models import Course, DocumentChunk, DocumentPage, Material, User
from backend.app.services.embeddings import embed_text
from backend.app.services.retrieval import retrieve_relevant_chunks


def test_retrieval_empty_question(db_session: Session, sample_user: User):
    results = retrieve_relevant_chunks(db_session, sample_user.id, "   ")
    assert results == []


def test_retrieval_finds_relevant_chunk(
    db_session: Session, sample_user: User, sample_course: Course, sample_material
):
    material, page, chunks = sample_material
    results = retrieve_relevant_chunks(
        db=db_session,
        user_id=sample_user.id,
        question="What is 3NF?",
        course_id=sample_course.id,
    )

    assert len(results) == 1
    chunk = results[0]
    assert chunk.material_id == material.id
    assert chunk.material_title == "Unit 3 - Normalization Notes"
    assert chunk.page_number == 1
    assert "Third Normal Form" in chunk.content
    assert chunk.rank == 1


def test_retrieval_strict_user_isolation(
    db_session: Session, sample_user: User, other_user: User, sample_material
):
    # sample_material belongs to sample_user. other_user queries the exact same content.
    results = retrieve_relevant_chunks(
        db=db_session,
        user_id=other_user.id,
        question="Third Normal Form",
    )
    # Must NOT return Alice's material to Bob!
    assert len(results) == 0


def test_retrieval_course_boundary(
    db_session: Session, sample_user: User, sample_course: Course, sample_material
):
    # Create another course for the same user
    other_course = Course(
        id=uuid.uuid4(),
        user_id=sample_user.id,
        name="Operating Systems",
        code="CS352",
    )
    db_session.add(other_course)
    db_session.commit()

    # Query with other_course.id should return nothing
    results = retrieve_relevant_chunks(
        db=db_session,
        user_id=sample_user.id,
        question="Third Normal Form",
        course_id=other_course.id,
    )
    assert len(results) == 0


def test_retrieval_skips_unready_materials(
    db_session: Session, sample_user: User, sample_course: Course
):
    # Material that is still pending
    m = Material(
        id=uuid.uuid4(),
        course_id=sample_course.id,
        title="Pending Notes",
        original_filename="pending.pdf",
        stored_path="test/pending.pdf",
        mime_type="application/pdf",
        file_size=1000,
        content_hash="b" * 64,
        status="pending",
    )
    db_session.add(m)
    p = DocumentPage(material_id=m.id, page_number=1)
    db_session.add(p)
    c = DocumentChunk(
        id=uuid.uuid4(),
        material_id=m.id,
        chunk_index=0,
        page_number=1,
        content="Secret pending information",
        embedding=[0.5] * 384,
    )
    db_session.add(c)
    db_session.commit()

    results = retrieve_relevant_chunks(
        db=db_session,
        user_id=sample_user.id,
        question="Secret pending information",
        course_id=sample_course.id,
    )
    assert len(results) == 0
