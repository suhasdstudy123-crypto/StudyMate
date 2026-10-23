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

## Stage 4 — Courses on real data

- **Course names are unique per student, ignoring case.** `UNIQUE (user_id, name)` allowed both "DBMS" and "dbms". It was replaced by a unique *expression index* `ON courses (user_id, lower(name))`. Different students can still both have "DBMS".
- **First migration file: `database/migrations/001_course_names_case_insensitive.sql`.** `schema.sql` starts with a DEV RESET that drops every table, so it can't be re-run on a database with data. A migration changes only what's needed and keeps the data. It runs inside `BEGIN ... COMMIT`: PostgreSQL can roll back schema changes too, so a failure leaves the old constraint in place. `schema.sql` was updated too, so a fresh database ends up identical.
- **Reading courses uses the `course_overview` VIEW with plain SQL** (`sqlalchemy.text`). Every endpoint returns a `CourseSummary` with `material_count`, `ready_material_count`, `chunk_count` and `last_activity`, so the cards show live numbers. Values are passed as **bind parameters** (`:user_id`), never pasted into the SQL string, so there's no SQL injection. Writing still goes through the ORM model.
- **Validation bug fixed.** `{"name": "   "}` passed `min_length=1` and was then rejected by the database CHECK, which came back as a wrong "duplicate name" 409. Now names are stripped *before* validation (`mode="before"`), so blank names get a clear 422. `{"name": null}` on PATCH is also a 422. Empty code/description become `NULL`.
- `GET /courses` is ordered by most recent activity.
- **Known for Stage 5:** deleting a course cascades to materials/chunks in the database, but uploaded files on disk must also be removed then.

## Stage 5a (part 1) — Upload and reading PDFs

- **Migration 002** adds `materials.pages_processed` (progress), the `document_pages` table (one row per page, composite primary key `(material_id, page_number)`), `document_chunks.chunk_type` (`text`/`table`), a **composite foreign key** chunk → page, a **partial index** on pages that need the image reader, and the `material_overview` view. Re-running it fails and rolls back (nothing changes).
- **PDF library: PyMuPDF 1.28.2.** It does text, tables, images, drawings and page rendering (needed in 5b) in one library. Licence is AGPL, which is fine for a public open-source repo; a closed-source product would need a commercial licence or another library. 2.0 was 3 days old, so the last 1.x release is pinned. `python-multipart` is what lets FastAPI read file uploads (multipart/form-data).
- **Upload checks, in order:** owner of the course (404) → size while copying (413, `MAX_UPLOAD_MB`) → empty (422) → starts with `%PDF-` (415; the file name and browser type are not trusted) → opens in PyMuPDF (422 damaged) → not password-protected (422) → 1..`MAX_PDF_PAGES` pages (422) → same SHA-256 already in this course (409, the UNIQUE constraint is the final guard).
- **Files on disk:** `backend/uploads/<user id>/<material id>.pdf` (gitignored). The student's file name is never part of a path (path traversal). The database stores only the relative path.
- **File + row consistency:** a database transaction can't undo a file write. So: move the file into place, then commit the row; if the commit fails, delete the file (compensating action). On delete: commit the row deletion first, then remove the file. Deleting a course now removes its files too.
- **Background processing:** a `ThreadPoolExecutor` (2 workers) inside the backend. Upload answers `202 Accepted` at once; the browser polls `GET /materials/{id}`. Jobs live in memory, so on startup (FastAPI **lifespan**) unfinished files are re-queued and leftover `.part` files removed.
- **Two sessions in the worker:** `work` = one transaction for all pages + chunks, committed once at the end (atomic: a crash leaves nothing half-done); `progress` = a tiny commit per page so the browser sees "page 12 of 40". Tested: another connection sees progress rising but 0 chunks until the final commit (isolation, READ COMMITTED). Killing the server at page 124 left 0 chunks; restart re-queued it and finished cleanly.
- **No deadlock between the two sessions:** inserting a page takes a `FOR KEY SHARE` lock on the materials row (foreign key check); the progress UPDATE only changes non-key columns, which needs `FOR NO KEY UPDATE`. PostgreSQL designed these two lock modes to be compatible.
- **Claiming a job** is a conditional `UPDATE ... WHERE status = 'pending' RETURNING`: only one worker can win the row.
- **A failed file stores no pages or chunks**, only `error_message` (deleted in the same transaction that marks it failed). Retry: `failed → pending`.
- **Delete while processing → 409** (the worker's transaction holds the row).
- **Extraction (`processing/extract.py`):** blocks sorted into reading order; repeated headers/footers (same text in the top/bottom 8% of ≥40% of pages, numbers ignored) and bare page numbers dropped; tables via `find_tables()` → markdown, kept whole, with the latest heading on top; text inside a table's area skipped (otherwise read twice); NUL/control characters removed (PostgreSQL TEXT can't store `\x00`).
- **needs_vision (for 5b):** embedded images, ≥3 drawings outside tables (diagrams), ≥3 maths symbols, or very little text plus a drawing. Table grid lines don't count as drawings.
- **Chunking (`processing/chunking.py`):** never across pages (exact page citations), ~900 characters, new chunk at headings, tables one chunk, one-sentence overlap between text chunks, tiny leftovers merged. `token_count` is an estimate until Stage 6 uses the real tokenizer.
- **Speed (sandbox):** a 300-page text PDF took ~27 s (≈90 ms per page, mostly table detection).
- **Tuned on a real lecture deck** (41 PES DBMS slides, made with Online2PDF). The first version flagged all 41 pages for the image reader and kept the slide header in every chunk. Fixes:
  - **Images actually drawn** (`get_image_info`), not every image a page *references* (this PDF attaches 107 to each page).
  - **Repeated things are decoration**, found in a first pass over the whole PDF: text in the top/bottom 12% on ≥40% of pages (header "Database Management Systems"), the same image or an image at the same spot on ≥40% of pages (logo), the same drawing at the same place (line under each title).
  - **Invisible drawings ignored:** white or unfilled shapes with no outline (text-box backgrounds), page-sized backgrounds.
  - **Page number as the last line of a block** is stripped.
  - **Broken justified lines rejoined** (a line not ending a sentence + one starting lowercase), even if the first line looked like a heading.
  - **Bullets normalised** (● ❏ ■ ▪ → •).
  - Result: 19 pages flagged = all 17 slides with screenshots/diagrams/image tables + the title and thank-you slides (big logo, only 2 pages, so not "repeated"; accepted to avoid hiding a diagram repeated on a recap slide). All 22 text slides correctly not flagged. 42 chunks, ~1 per slide.
- **`PATCH /materials/{id}`** renames a file (`title`, 1–255 characters, stripped before validation; blank → 422; someone else's file → 404). Only the display name changes; the stored file and its chunks are untouched.

## Stage 5b — Reading pages as images (step 1: decisions + page pictures)

- **Provider: Google Gemini API** (one key, `GEMINI_API_KEY`). Compared in Oct 2026 against Groq and Mistral. Gemini read slides/screenshots/tables most accurately (Roboflow vision evals: 3.8 Flash #7/63, transcription 94%; Gemini 3 Flash #1 on OmniDocBench). Groq: most private (no retention) but 8K tokens/min and 200K/day on the free tier (~65 picture pages a day). Mistral OCR: strong on documents but the free plan trains on data, and chat is a separate API. **Trade-off accepted:** on Gemini's free tier Google may use inputs/outputs to improve its products; fine for course slides in development, turn on billing before real users.
- **Chat model decided in Stage 7, not now:** vision and chat only meet through the database (vision writes passages, chat reads them), so they can come from different providers. Stage 7 will test Gemini vs Groq on the same questions.
- **Free-tier limits measured in AI Studio (per model):** gemini-3.8-flash 5 requests/min, 250K tokens/min, **20 requests/day**; gemini-3.5-flash-lite 15/min, 250K/min, 500/day. Requests, not tokens, are the bottleneck → several pages per request. Daily quota resets at midnight Pacific (12:30 IST; 13:30 IST in winter).
- **Pinned model names, never `*-latest` aliases:** an alias can silently switch model and change results. The name lives in `.env` so a retired model is a one-line change. Each page records `vision_model`.
- **Migration 003:** `materials.processing_mode` (smart/thorough); per-page `vision_status` (none → pending → processing → done | failed), `vision_attempts`, `vision_error` (required when failed), `vision_model`, `image_path`; `document_chunks.source` (pdf_text/vision) separate from `chunk_type` (text/table/diagram) because WHAT a passage is and HOW it was read are independent facts; partial index for the reader's queue; `material_overview` gets counts via `CROSS JOIN LATERAL` + `count(*) FILTER (...)` (one pass over the pages). Existing picture pages were queued (`pending`). `CREATE OR REPLACE VIEW` may only add columns at the end.
- **Page pictures (`processing/render.py`):** the WHOLE page, not just embedded images, because many diagrams are vector drawings with no image inside, and the slide around a screenshot gives it meaning. PNG (lossless, sharp text) at 2000 px on the long side (`PAGE_IMAGE_LONG_SIDE`): ~210 KB and ~0.1 s per slide; JPEG was no smaller on slides.
- **Stored as** `uploads/<user>/<material>/page-0012.png`: one folder per file, deleted with it (file delete and course delete). Written atomically (temp name + `os.replace`) so a crash never leaves half a picture.
- **When:** after the text pass commits, outside its transaction: a picture that fails to save must not undo a correctly read file. Each picture is committed on its own. On startup, pending pages without a picture get one (this covered files uploaded before 5b).
- **`GET /materials/{id}/pages/{n}/image`:** owner check like everything else (someone else's → 404), `Cache-Control: private` (only the student's own browser caches their notes).
- **Upload takes `mode`** as a second form field next to the file (`Literal["smart","thorough"]`, anything else → 422).
