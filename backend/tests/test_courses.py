"""
Tests for Course CRUD and ownership in backend/app/routers/courses.py.
"""

import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.models import Course, User
from backend.app.routers.courses import (
    create_course,
    delete_course,
    get_course,
    list_my_courses,
    update_course,
)
from backend.app.schemas import CourseCreate, CourseUpdate


def test_course_crud(db_session: Session, sample_user: User):
    # 1. Create
    course_data = CourseCreate(
        name="Operating Systems",
        code="CS352",
        description="Processes, threads, and memory",
    )
    course = create_course(data=course_data, db=db_session, current_user=sample_user)
    assert course.id is not None
    assert course.name == "Operating Systems"
    assert course.code == "CS352"

    # 2. Read single
    fetched = get_course(course_id=course.id, db=db_session, current_user=sample_user)
    assert fetched.id == course.id
    assert fetched.name == "Operating Systems"

    # 3. Read list
    course_list = list_my_courses(db=db_session, current_user=sample_user)
    assert len(course_list) >= 1
    assert any(c.id == course.id for c in course_list)

    # 4. Update
    updated = update_course(
        course_id=course.id,
        data=CourseUpdate(name="Advanced Operating Systems"),
        db=db_session,
        current_user=sample_user,
    )
    assert updated.name == "Advanced Operating Systems"
    assert updated.code == "CS352"

    # 5. Delete
    delete_course(course_id=course.id, db=db_session, current_user=sample_user)
    with pytest.raises(HTTPException) as exc:
        get_course(course_id=course.id, db=db_session, current_user=sample_user)
    assert exc.value.status_code == 404


def test_course_cross_user_isolation(
    db_session: Session, sample_user: User, other_user: User
):
    course = create_course(
        data=CourseCreate(name="Private Course"),
        db=db_session,
        current_user=sample_user,
    )

    # Bob should receive 404 when attempting to access Alice's course
    with pytest.raises(HTTPException) as exc:
        get_course(course_id=course.id, db=db_session, current_user=other_user)
    assert exc.value.status_code == 404

    # Bob should receive 404 when attempting to update Alice's course
    with pytest.raises(HTTPException) as exc:
        update_course(
            course_id=course.id,
            data=CourseUpdate(name="Hacked Name"),
            db=db_session,
            current_user=other_user,
        )
    assert exc.value.status_code == 404

    # Bob should receive 404 when attempting to delete Alice's course
    with pytest.raises(HTTPException) as exc:
        delete_course(course_id=course.id, db=db_session, current_user=other_user)
    assert exc.value.status_code == 404
