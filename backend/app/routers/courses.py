from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import Course, Material, User
from backend.app.schemas import CourseCreate, CourseSummary, CourseUpdate
from backend.app.storage import delete_material_files

# Every route here requires a logged-in user, and only ever touches
# that user's OWN courses. The client never says whose courses these
# are - the owner always comes from the verified token.

router = APIRouter(prefix="/courses", tags=["Courses"])


# ------------------------------------------------------------------
# Reading: plain SQL against the course_overview VIEW
# ------------------------------------------------------------------
# The view (schema.sql) joins courses -> materials -> document_chunks and
# counts them, so a course card can say "3 PDFs, 2 ready". We write the
# SQL ourselves here because this is a read-only report query.
#
# :user_id and :course_id are BIND PARAMETERS. The values are sent to
# PostgreSQL separately from the SQL text, so a value can never be run
# as SQL (no SQL injection), even though we wrote raw SQL.
SUMMARY_SQL = """
    SELECT id, name, code, description, created_at,
           material_count, ready_material_count, chunk_count, last_activity
    FROM course_overview
    WHERE user_id = :user_id
"""


def list_summaries(db: Session, user: User) -> list[CourseSummary]:
    rows = db.execute(
        text(SUMMARY_SQL + " ORDER BY last_activity DESC, name"),
        {"user_id": user.id},
    ).mappings()
    return [CourseSummary(**row) for row in rows]


def get_summary(db: Session, course_id: UUID, user: User) -> CourseSummary:
    # "AND user_id = :user_id" is the ownership check: someone else's
    # course simply isn't found -> 404, so nobody can even learn that a
    # course id exists if it isn't theirs.
    row = db.execute(
        text(SUMMARY_SQL + " AND id = :course_id"),
        {"user_id": user.id, "course_id": course_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return CourseSummary(**row)


# ------------------------------------------------------------------
# Writing: through the ORM (Course model)
# ------------------------------------------------------------------

def get_owned_course_or_404(db: Session, course_id: UUID, user: User) -> Course:
    #   SELECT ... FROM courses WHERE id = :id AND user_id = :me
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == user.id)
        .first()
    )
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return course


def commit_or_409(db: Session) -> None:
    # The database enforces "one name per student, ignoring case"
    # (unique index on user_id, lower(name)). Validation in schemas.py
    # already rejected blank names, so the only write the database can
    # still refuse here is a duplicate name. Undo the transaction and
    # say why, instead of crashing with a 500 error.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "You already have a course with this name"
        )


@router.post("", response_model=CourseSummary, status_code=status.HTTP_201_CREATED)
def create_course(
    data: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = Course(
        user_id=current_user.id,
        name=data.name,
        code=data.code,
        description=data.description,
    )
    db.add(course)
    commit_or_409(db)
    return get_summary(db, course.id, current_user)


@router.get("", response_model=list[CourseSummary])
def list_my_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Most recently active first: the course you're studying now is on top.
    return list_summaries(db, current_user)


@router.get("/{course_id}", response_model=CourseSummary)
def get_course(
    course_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_summary(db, course_id, current_user)


@router.patch("/{course_id}", response_model=CourseSummary)
def update_course(
    course_id: UUID,
    data: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = get_owned_course_or_404(db, course_id, current_user)

    # exclude_unset=True: only the fields the client actually sent, so a
    # rename ({"name": "..."}) doesn't wipe the code or description.
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    # No manual updated_at here: the set_updated_at trigger handles it.

    commit_or_409(db)
    return get_summary(db, course.id, current_user)


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = get_owned_course_or_404(db, course_id, current_user)
    files = db.query(Material.stored_path, Material.status).filter(Material.course_id == course.id).all()
    if any(f.status == "processing" for f in files):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A file in this course is being read right now. Try again when it's done.",
        )
    # ON DELETE CASCADE in the schema removes its materials, pages and
    # chunks; its chat sessions are kept with course_id set to NULL.
    db.delete(course)
    db.commit()
    # The database can't delete files on disk, so we do it after the commit.
    delete_material_files([f.stored_path for f in files])
