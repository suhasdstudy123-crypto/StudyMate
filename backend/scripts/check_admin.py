"""
Stage 8 check: the admin dashboard API keeps its promises.

Run from the studymate folder (venv active; migration 007 applied;
the backend may keep running):
    python -m backend.scripts.check_admin

It calls the real routes in-process (FastAPI TestClient, no server needed)
against your real database, with THROW-AWAY accounts it creates and deletes
again at the end (check-admin-...@example.com; deleting the users cascades
to their courses, files and chats). Your own data is only read (counts).

What it proves:
  1. Visitors get 401 and students get 403 on EVERY admin route.
  2. Privacy: a student's course name, file title, chat title, question and
     answer all contain a secret marker; no admin response contains it.
  3. The database guard: the read-only role is refused the content tables.
  4. Deactivate: the student's existing token stops working at once (401),
     re-activating restores it; admin accounts can't be deactivated (409).
  5. Cleanup removes empty chats older than an hour and keeps newer ones.
  6. The numbers add up (questions per day sum, empty-chat count).
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.routers.admin import reader_session
from backend.app.security import create_access_token

TAG = uuid.uuid4().hex[:8]
SECRET = f"SECRET-{TAG}"          # what must never reach the admin
# Not "with TestClient(app)": that would run the startup (workers, model).
client = TestClient(app)

ADMIN_GETS = ["/admin/overview", "/admin/users", "/admin/stats/chat?days=30"]
ADMIN_ROUTES = [("GET", p) for p in ADMIN_GETS] + [
    ("PATCH", f"/admin/users/{uuid.uuid4()}"),
    ("POST", "/admin/cleanup/empty-chats"),
]

passed = failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    passed, failed = passed + ok, failed + (not ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   ({detail})" if detail and not ok else ""))


def call(method: str, path: str, token: str | None = None, **kw):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.request(method, path, headers=headers, **kw)


def make_data(db) -> dict:
    """Two throw-away accounts and one student's private study data."""
    ids = {}
    for role in ("admin", "student"):
        ids[role] = db.execute(text("""
            INSERT INTO users (name, email, password_hash, role)
            VALUES (:n, :e, 'not-a-real-hash', :r) RETURNING id
        """), {"n": f"Check {role} {TAG}", "e": f"check-admin-{role}-{TAG}@example.com", "r": role}).scalar_one()
    student = ids["student"]
    course = db.execute(text("INSERT INTO courses (user_id, name) VALUES (:u, :n) RETURNING id"),
                        {"u": student, "n": f"{SECRET} course"}).scalar_one()
    db.execute(text("""
        INSERT INTO materials (course_id, title, original_filename, stored_path, mime_type,
                               file_size, content_hash, status, page_count, pages_processed)
        VALUES (:c, :t, :t, 'nowhere.pdf', 'application/pdf', 1, :h, 'ready', 1, 1)
    """), {"c": course, "t": f"{SECRET} file.pdf", "h": uuid.uuid4().hex * 2})
    chat = db.execute(text("INSERT INTO chat_sessions (user_id, course_id, title) VALUES (:u, :c, :t) RETURNING id"),
                      {"u": student, "c": course, "t": f"{SECRET} chat title"}).scalar_one()
    db.execute(text("INSERT INTO chat_messages (session_id, role, content) VALUES (:s, 'user', :q)"),
               {"s": chat, "q": f"{SECRET} question"})
    db.execute(text("""
        INSERT INTO chat_messages (session_id, role, content, status, model, prompt_tokens, output_tokens)
        VALUES (:s, 'assistant', :a, 'answered', 'check-model', 100, 20)
    """), {"s": chat, "a": f"{SECRET} answer"})
    # Two EMPTY chats: one 2 hours old (cleanup removes it), one brand new
    # (maybe still streaming its first answer: cleanup must keep it).
    ids["old_empty"] = db.execute(text("""
        INSERT INTO chat_sessions (user_id, course_id, created_at) VALUES (:u, :c, now() - interval '2 hours')
        RETURNING id"""), {"u": student, "c": course}).scalar_one()
    ids["new_empty"] = db.execute(text("""
        INSERT INTO chat_sessions (user_id, course_id) VALUES (:u, :c) RETURNING id"""),
        {"u": student, "c": course}).scalar_one()
    db.commit()
    return ids


def main() -> None:
    with SessionLocal() as db:
        ids = make_data(db)
    admin_token = create_access_token(ids["admin"])
    student_token = create_access_token(ids["student"])
    try:
        print("1. Who may call the admin API")
        for method, path in ADMIN_ROUTES:
            check(f"visitor {method} {path.split('?')[0]} -> 401", call(method, path).status_code == 401)
            r = call(method, path, student_token, json={"is_active": False})
            check(f"student {method} {path.split('?')[0]} -> 403", r.status_code == 403, str(r.status_code))
        for path in ADMIN_GETS:
            r = call("GET", path, admin_token)
            check(f"admin GET {path} -> 200", r.status_code == 200, r.text[:200])

        print("2. Privacy: no student content in any admin response")
        for path in ADMIN_GETS:
            body = call("GET", path, admin_token).text
            check(f"{path} has no course/file/chat/question/answer text", SECRET not in body)
        me = next(u for u in call("GET", "/admin/users", admin_token).json() if u["id"] == str(ids["student"]))
        check("student row counts: 1 course, 1 file, 1 chat, 1 question",
              (me["course_count"], me["file_count"], me["chat_count"], me["question_count"]) == (1, 1, 1, 1), str(me))
        check("a user row has only metadata fields", set(me) == {
            "id", "name", "email", "role", "is_active", "joined_at", "course_count", "file_count",
            "pages_total", "chat_count", "question_count", "not_in_notes_count", "last_question_at"}, str(set(me)))

        print("3. Database guard: the read-only role")
        for sql in ["SELECT content FROM chat_messages LIMIT 1", "SELECT title FROM chat_sessions LIMIT 1",
                    "SELECT name FROM courses LIMIT 1", "SELECT content FROM document_chunks LIMIT 1",
                    "SELECT delete_empty_chat_sessions()"]:
            with reader_session() as r:
                try:
                    r.execute(text(sql))
                    check(f"refused: {sql}", False, "it was allowed!")
                except ProgrammingError as e:
                    check(f"refused: {sql}", "permission denied" in str(e))
        with SessionLocal() as db:
            role = db.execute(text("SELECT current_user")).scalar_one()
        check(f"after the admin read, the pooled connection is the app role again ({role})",
              role != "studymate_admin_reader")

        print("4. Deactivate / activate")
        check("student token works before", call("GET", "/auth/me", student_token).status_code == 200)
        r = call("PATCH", f"/admin/users/{ids['student']}", admin_token, json={"is_active": False})
        check("deactivate -> 200, is_active false", r.status_code == 200 and r.json()["is_active"] is False, r.text)
        check("SAME token is refused at once -> 401", call("GET", "/auth/me", student_token).status_code == 401)
        r = call("PATCH", f"/admin/users/{ids['student']}", admin_token, json={"is_active": True})
        check("activate -> 200, token works again",
              r.status_code == 200 and call("GET", "/auth/me", student_token).status_code == 200)
        r = call("PATCH", f"/admin/users/{ids['admin']}", admin_token, json={"is_active": False})
        check("deactivating an admin -> 409", r.status_code == 409, str(r.status_code))
        r = call("PATCH", f"/admin/users/{uuid.uuid4()}", admin_token, json={"is_active": False})
        check("unknown user -> 404", r.status_code == 404, str(r.status_code))
        r = call("PATCH", f"/admin/users/{ids['student']}", admin_token, json={"is_active": "maybe"})
        check("bad body -> 422", r.status_code == 422, str(r.status_code))

        print("5. Empty-chat cleanup")
        before = call("GET", "/admin/overview", admin_token).json()["chats_empty"]
        r = call("POST", "/admin/cleanup/empty-chats", admin_token)
        check("cleanup -> 200", r.status_code == 200, r.text)
        with SessionLocal() as db:
            left = set(db.execute(text("SELECT id FROM chat_sessions WHERE id IN (:a, :b)"),
                                  {"a": ids["old_empty"], "b": ids["new_empty"]}).scalars())
        check("2-hour-old empty chat removed", ids["old_empty"] not in left)
        check("brand-new empty chat kept (may still be answering)", ids["new_empty"] in left)
        after = call("GET", "/admin/overview", admin_token).json()["chats_empty"]
        check(f"empty chats {before} -> {after} (deleted {r.json()['deleted']})", after == before - r.json()["deleted"])

        print("6. Numbers add up")
        o = call("GET", "/admin/overview", admin_token).json()
        stats = call("GET", "/admin/stats/chat?days=365", admin_token).json()
        check("365 days returned, oldest first", len(stats["days"]) == 365 and stats["days"][0]["day"] < stats["days"][-1]["day"])
        check("questions per day add up to the total (within a year)",
              sum(d["questions"] for d in stats["days"]) <= o["questions_total"])
        check("today includes the check's question", stats["days"][-1]["questions"] >= 1)
        check("model usage lists the check's model",
              any(m["model"] == "check-model" and m["answers"] >= 1 for m in stats["models"]))
        check("days outside 7..365 -> 422", call("GET", "/admin/stats/chat?days=3", admin_token).status_code == 422)
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM users WHERE email LIKE :p"), {"p": f"check-admin-%-{TAG}@example.com"})
            db.commit()
        print(f"\nCleaned up the throw-away accounts. {passed} passed, {failed} failed.")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
