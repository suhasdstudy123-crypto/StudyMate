from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Course, User
from backend.app.schemas import CourseCreate, CourseResponse, CourseUpdate

# TEMPORARY (until Stage 3 auth): the client still says which user it is
# via user_id. Stage 3 replaces that with the logged-in user from the JWT,
# and every route below will only ever see that user's own courses.

router = APIRouter(prefix="/courses", tags=["Courses"])


def get_course_or_404(db: Session, course_id: UUID) -> Course:
    # db.get() looks a row up by primary key (SELECT ... WHERE id = ...).
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return course


def commit_or_409(db: Session) -> None:
    # The database enforces UNIQUE (user_id, name). If it rejects the
    # write, undo the transaction and tell the client why, instead of
    # crashing with a 500 error.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "You already have a course with this name"
        )


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(data: CourseCreate, db: Session = Depends(get_db)):
    if db.get(User, data.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    course = Course(
        user_id=data.user_id,
        name=data.name.strip(),
        code=data.code,
        description=data.description,
    )
    db.add(course)
    commit_or_409(db)
    db.refresh(course)  # load DB-generated values: id, created_at, ...
    return course


@router.get("/user/{user_id}", response_model=list[CourseResponse])
def list_user_courses(user_id: UUID, db: Session = Depends(get_db)):
    return (
        db.query(Course)
        .filter(Course.user_id == user_id)
        .order_by(Course.created_at)
        .all()
    )


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: UUID, db: Session = Depends(get_db)):
    return get_course_or_404(db, course_id)


@router.patch("/{course_id}", response_model=CourseResponse)
def update_course(course_id: UUID, data: CourseUpdate, db: Session = Depends(get_db)):
    course = get_course_or_404(db, course_id)

    # exclude_unset=True: only fields the client actually sent.
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    # No manual updated_at here: the set_updated_at trigger handles it.

    commit_or_409(db)
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: UUID, db: Session = Depends(get_db)):
    course = get_course_or_404(db, course_id)
    # ON DELETE CASCADE in the schema removes its materials and chunks.
    db.delete(course)
    db.commit()
