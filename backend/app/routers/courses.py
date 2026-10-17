from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import Course, User
from backend.app.schemas import CourseCreate, CourseResponse, CourseUpdate

# Every route here requires a logged-in user, and only ever touches
# that user's OWN courses. The client never says whose courses these
# are - the owner always comes from the verified token.

router = APIRouter(prefix="/courses", tags=["Courses"])


def get_owned_course_or_404(db: Session, course_id: UUID, user: User) -> Course:
    # Filter by id AND owner in one query:
    #   SELECT ... FROM courses WHERE id = :id AND user_id = :me
    # Someone else's course gives 404 (not 403), so nobody can even
    # learn that a course id exists if it isn't theirs.
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == user.id)
        .first()
    )
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
def create_course(
    data: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = Course(
        user_id=current_user.id,
        name=data.name.strip(),
        code=data.code,
        description=data.description,
    )
    db.add(course)
    commit_or_409(db)
    db.refresh(course)  # load DB-generated values: id, created_at, ...
    return course


@router.get("", response_model=list[CourseResponse])
def list_my_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Course)
        .filter(Course.user_id == current_user.id)
        .order_by(Course.created_at)
        .all()
    )


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_owned_course_or_404(db, course_id, current_user)


@router.patch("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: UUID,
    data: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = get_owned_course_or_404(db, course_id, current_user)

    # exclude_unset=True: only fields the client actually sent.
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value.strip() if field == "name" else value)
    # No manual updated_at here: the set_updated_at trigger handles it.

    commit_or_409(db)
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = get_owned_course_or_404(db, course_id, current_user)
    # ON DELETE CASCADE in the schema removes its materials and chunks.
    db.delete(course)
    db.commit()
