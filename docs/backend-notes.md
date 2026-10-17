# Backend Notes

A running log of backend decisions and why they were made.

## Phase 0 — Project setup

- **Dev server runs on port 8001, not 8000.** A fingerprint-scanner program on this machine (SecuGen `sgibiosrv.exe`, starts at Windows login) already listens on `0.0.0.0:8000`. Windows still lets uvicorn bind `127.0.0.1:8000`, so there is no startup error. But any request that doesn't reach uvicorn goes to SecuGen instead, which drops it (`ERR_CONNECTION_RESET`). Port 8001 is free, so every request reaches our server, and when the server is down you get a clear "connection refused".
  Run command (from `backend/`, venv active): `python -m uvicorn app.main:app --reload --port 8001`
- **`requirements.txt` comes from `pip freeze` with exact versions.** The venv (Python 3.10.11) only has FastAPI and uvicorn plus their dependencies. Pinning every package gives everyone identical installs. It gets regenerated whenever a package is added.
- **`.env.example` is at the repo root and holds variable names only.** Phase.md puts it at the root. The real `.env` goes in `backend/` (see Phase.md repo structure), and `.gitignore` excludes it.
- **Starter env vars are `DATABASE_URL`, `JWT_SECRET_KEY` and `LLM_API_KEY`.** They cover the database (Phase 1), auth (JWT) and the LLM call in the RAG pipeline. More get added only when a phase needs them.
- **`database/` starts with just a `.gitkeep`.** Git doesn't track empty folders. `schema.sql` / `seed.sql` arrive in Phase 1.
- **`.gitignore` needed no changes.** It already ignores `venv/`, `.venv/`, `.env`, `.env.local` and `__pycache__/`. Checked with `git check-ignore`.
