"""
Admin dashboard API (Stage 8). Admin-only: every route depends on
require_admin (router-level), so a student gets 403 and a visitor 401.

PRIVACY RULE: the admin sees how StudyMate is USED, never WHAT students
study. No note text, passages, questions, answers, chat titles (a title is
the first question), course names, file titles or file names. Enforced in
three layers, so one mistake isn't enough to leak anything:

  1. Role check       require_admin on the whole router (401 / 403).
  2. Database role    every read runs as studymate_admin_reader, which may
                      SELECT the four admin_* views (migration 007) and
                      nothing else. A buggy query on chat_messages.content
                      fails with "permission denied" instead of leaking.
  3. Response shapes  the Admin* schemas have no field for any content, so
                      FastAPI drops anything extra before it is sent.

    GET   /admin/overview              platform totals (one row)
    GET   /admin/users                 one row per user with counts
    PATCH /admin/users/{id}            activate / deactivate a STUDENT
    GET   /admin/stats/chat?days=30    questions per day + per-model usage
    POST  /admin/cleanup/empty-chats   delete chats whose first question never saved
"""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.database import SessionLocal, get_db
from backend.app.deps import require_admin
from backend.app.schemas import (
    AdminChatDay,
    AdminChatStats,
    AdminCleanupResult,
    AdminModelUsage,
    AdminOverview,
    AdminUser,
    AdminUserUpdate,
)

# dependencies=[...] on the router applies the check to EVERY route
# in this file, so a future admin route can't forget it.
router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_admin)])

# How old an empty chat must be before cleanup removes it: a newer one may
# still be streaming its first answer (see delete_empty_chat_sessions).
EMPTY_CHAT_MIN_AGE = "1 hour"


@contextmanager
def reader_session() -> Iterator[Session]:
    """A database session that can ONLY read the admin views.

    Its own session (not the request's get_db one, which require_admin used
    to load the user as the normal app role).

    SET LOCAL lasts until the end of the current TRANSACTION. close() ends
    the transaction (rollback; we never write here), so the pooled connection
    goes back as the normal app role. A plain SET would stay on the pooled
    connection and the NEXT request using it would still be the reader.
    """
    db = SessionLocal()
    try:
        db.execute(text("SET LOCAL ROLE studymate_admin_reader"))
        yield db
    finally:
        db.close()


def admin_reader() -> Iterator[Session]:
    # The same, as a route dependency: Depends(admin_reader).
    with reader_session() as db:
        yield db


USERS_SQL = text("""
    SELECT * FROM admin_user_stats
    WHERE CAST(:id AS uuid) IS NULL OR id = CAST(:id AS uuid)
    ORDER BY role = 'admin' DESC, joined_at DESC
""")

# Every day of the window, also the quiet ones: generate_series makes the
# list of days, LEFT JOIN fills in the view's numbers (or 0 via coalesce).
# "Today" is today in India, matching the view's IST days.
CHAT_DAYS_SQL = text("""
    SELECT d::date AS day,
           coalesce(v.questions, 0)     AS questions,
           coalesce(v.answered, 0)      AS answered,
           coalesce(v.not_in_notes, 0)  AS not_in_notes,
           coalesce(v.stopped, 0)       AS stopped,
           coalesce(v.active_users, 0)  AS active_users,
           coalesce(v.prompt_tokens, 0) AS prompt_tokens,
           coalesce(v.output_tokens, 0) AS output_tokens
    FROM generate_series(
            (now() AT TIME ZONE 'Asia/Kolkata')::date - (:days - 1),
            (now() AT TIME ZONE 'Asia/Kolkata')::date,
            interval '1 day') AS d
    LEFT JOIN admin_chat_daily v ON v.day = d::date
    ORDER BY d
""")


@router.get("/overview", response_model=AdminOverview)
def overview(db: Session = Depends(admin_reader)):
    return db.execute(text("SELECT * FROM admin_overview")).mappings().one()


@router.get("/users", response_model=list[AdminUser])
def list_users(db: Session = Depends(admin_reader)):
    return db.execute(USERS_SQL, {"id": None}).mappings().all()


@router.patch("/users/{user_id}", response_model=AdminUser)
def update_user(user_id: UUID, body: AdminUserUpdate, db: Session = Depends(get_db)):
    """Activate or deactivate a student. Nothing is deleted: a deactivated
    student can't log in or use an old token (get_current_user reloads the
    user on every request), and re-activating restores everything.

    Only students: an admin can't lock out themselves or the last admin.
    (Admins are managed in psql.)"""
    role = db.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user_id}).scalar_one_or_none()
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if role != "student":
        raise HTTPException(status.HTTP_409_CONFLICT, "Admin accounts can't be deactivated here.")
    # role = 'student' again in the WHERE: if the role changed between the two
    # statements, the UPDATE simply matches nothing.
    db.execute(text("UPDATE users SET is_active = :active WHERE id = :id AND role = 'student'"),
               {"active": body.is_active, "id": user_id})
    db.commit()
    # Read the fresh row back through the read-only role, like every admin read.
    with reader_session() as reader:
        return reader.execute(USERS_SQL, {"id": user_id}).mappings().one()


@router.get("/stats/chat", response_model=AdminChatStats)
def chat_stats(days: int = Query(30, ge=7, le=365), db: Session = Depends(admin_reader)):
    day_rows = db.execute(CHAT_DAYS_SQL, {"days": days}).mappings().all()
    model_rows = db.execute(text(
        "SELECT * FROM admin_model_usage ORDER BY answers + pages_read DESC, model"
    )).mappings().all()
    return AdminChatStats(
        days=[AdminChatDay(**r) for r in day_rows],
        models=[AdminModelUsage(**r) for r in model_rows],
    )


@router.post("/cleanup/empty-chats", response_model=AdminCleanupResult)
def cleanup_empty_chats(db: Session = Depends(get_db)):
    # A write, so the normal app role (the reader can't DELETE).
    deleted = db.execute(
        text("SELECT delete_empty_chat_sessions(CAST(:age AS interval))"), {"age": EMPTY_CHAT_MIN_AGE}
    ).scalar_one()
    db.commit()
    return AdminCleanupResult(deleted=deleted)
