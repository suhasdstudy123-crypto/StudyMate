# Backend Notes

A running log of backend decisions and why they were made.

## Phase 0 — Project setup

- **Dev server runs on port 8001, not 8000.** A fingerprint-scanner program on this machine (SecuGen `sgibiosrv.exe`, starts at Windows login) already listens on `0.0.0.0:8000`. Windows still lets uvicorn bind `127.0.0.1:8000`, so there is no startup error. But any request that doesn't reach uvicorn goes to SecuGen instead, which drops it (`ERR_CONNECTION_RESET`). Port 8001 is free, so every request reaches our server, and when the server is down you get a clear "connection refused".
  Run command (from the repo root `studymate/`, venv active): `python -m uvicorn backend.app.main:app --reload --port 8001`. It runs from the root because the code imports `backend.app...`.
- **`requirements.txt` comes from `pip freeze` with exact versions.** The venv (Python 3.10.11) only has FastAPI and uvicorn plus their dependencies. Pinning every package gives everyone identical installs. It gets regenerated whenever a package is added.
- **`.env.example` is at the repo root and holds variable names only.** Phase.md puts it at the root. The real `.env` goes in `backend/` (see Phase.md repo structure), and `.gitignore` excludes it.
- **Starter env vars are `DATABASE_URL`, `JWT_SECRET_KEY` and `LLM_API_KEY`.** They cover the database (Phase 1), auth (JWT) and the LLM call in the RAG pipeline. More get added only when a phase needs them.
- **`database/` starts with just a `.gitkeep`.** Git doesn't track empty folders. `schema.sql` / `seed.sql` arrive in Phase 1.
- **`.gitignore` needed no changes.** It already ignores `venv/`, `.venv/`, `.env`, `.env.local` and `__pycache__/`. Checked with `git check-ignore`.

## Stage 3 — Authentication and authorization

- **Passwords: Argon2id via `argon2-cffi`.** Argon2id is memory-hard (64 MiB per hash), so GPU brute-forcing is slow and expensive. Each hash has its own random salt inside the string. Not passlib: it is unmaintained and breaks with newer bcrypt versions.
- **Login errors are identical for "no such email" and "wrong password"**, and a dummy hash is checked when the email doesn't exist so both cases take the same time. This stops attackers finding out which emails have accounts.
- **JWT (PyJWT, HS256), payload = `sub` (user id), `iat`, `exp`.** No role inside the token: `get_current_user` loads the user from the database on every request, so a role change or deactivation applies immediately. Cost: one primary-key lookup per request.
- **Token travels in an httpOnly, SameSite=Lax cookie** (`studymate_token`) for the browser, so page JavaScript can't read it (XSS can't steal it). An `Authorization: Bearer` header also works, for /docs and API clients; the header wins if both are sent.
- **Known JWT trade-off:** logout deletes the cookie but a copied token stays valid until `exp` (1 day). Fixing that needs a server-side denylist or short tokens + refresh tokens; not needed at this scale.
- **Register can't set a role.** Every account starts as `student`. Admins are promoted in SQL: `UPDATE users SET role = 'admin' WHERE email = '...';`
- **401 vs 403 vs 404:** 401 = not logged in / bad token; 403 = logged in but not allowed (student on `/admin/*`); 404 for another user's course, so its existence isn't revealed.
- **Courses take the owner from the token**, never from the request body. `/courses/user/{user_id}` was removed; `GET /courses` returns your own.
- Settings and `.env` loading moved from `database.py` to `config.py`; the app refuses to start without `DATABASE_URL` or a `JWT_SECRET_KEY` of at least 32 characters.
