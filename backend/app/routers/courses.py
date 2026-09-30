from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Course, User
from backend.app.schemas import (
    CourseCreate,
    CourseResponse,
    CourseUpdate,
)


router = APIRouter(
    prefix="/courses",
    tags=["Courses"],
)


# =========================================================
# CREATE COURSE
# POST /courses
# =========================================================
@router.post(
    "",
    response_model=CourseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_course(
    course_data: CourseCreate,
    db: Session = Depends(get_db),
):
    # Check whether the user exists
    user = (
        db.query(User)
        .filter(User.id == course_data.user_id)
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Create new course
    new_course = Course(
        user_id=course_data.user_id,
        name=course_data.name,
        code=course_data.code,
        description=course_data.description,
    )

    db.add(new_course)
    db.commit()
    db.refresh(new_course)

    return new_course


# =========================================================
# GET ALL COURSES FOR A USER
# GET /courses/user/{user_id}
# =========================================================
# IMPORTANT:
# This route is placed BEFORE /{course_id}
# so "user" is not interpreted as a UUID.
# =========================================================
@router.get(
    "/user/{user_id}",
    response_model=list[CourseResponse],
)
def get_user_courses(
    user_id: UUID,
    db: Session = Depends(get_db),
):
    # Check whether user exists
    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    courses = (
        db.query(Course)
        .filter(Course.user_id == user_id)
        .order_by(Course.created_at)
        .all()
    )

    return courses


# =========================================================
# GET COURSE BY ID
# GET /courses/{course_id}
# =========================================================
@router.get(
    "/{course_id}",
    response_model=CourseResponse,
)
def get_course(
    course_id: UUID,
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == course_id)
        .first()
    )

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    return course


# =========================================================
# UPDATE COURSE
# PATCH /courses/{course_id}
# =========================================================
@router.patch(
    "/{course_id}",
    response_model=CourseResponse,
)
def update_course(
    course_id: UUID,
    course_data: CourseUpdate,
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == course_id)
        .first()
    )

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Get only fields supplied by the client
    update_data = course_data.model_dump(
        exclude_unset=True
    )

    if "name" in update_data:
        course.name = update_data["name"]

    if "code" in update_data:
        course.code = update_data["code"]

    if "description" in update_data:
        course.description = update_data["description"]

    # Update timestamp
    course.updated_at = datetime.now()

    db.commit()
    db.refresh(course)

    return course


# =========================================================
# DELETE COURSE
# DELETE /courses/{course_id}
# =========================================================
@router.delete(
    "/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_course(
    course_id: UUID,
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == course_id)
        .first()
    )

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    db.delete(course)
    db.commit()

    return None