# StudyMate

Upload your study material and ask questions about it. StudyMate answers only from your own notes, shows the page every answer came from, and says so when the answer isn't in your notes.

## What it does

- Make a course for each subject and upload PDFs: lecture notes, slides, previous-year papers.
- StudyMate reads every page. Normal text is extracted directly. Pages with pictures, diagrams, formulas or scans are read by an AI vision model.
- Search your notes by meaning and by keywords at the same time.
- Ask questions in a chat. Every sentence in the answer cites the passage it came from, and you can open the exact page with the passage marked.
- If the answer isn't in your notes, it says "not in your notes" instead of making something up.
- Admins see how the site is used (users, files, questions per day, model usage). They never see students' notes, questions or answers.

## How it works

```text
Browser -> Next.js -> FastAPI -> PostgreSQL + pgvector
                         |
                         +-> Gemini (reads picture pages, writes answers)
                         +-> Qwen3 embedding model (runs locally)
```

1. **Upload:** the PDF is split into pages and the text into small passages. Pages with pictures go to Gemini to be read.
2. **Embed:** each passage is turned into 1024 numbers (an embedding) that capture its meaning, and stored in PostgreSQL with pgvector.
3. **Search:** a question is embedded the same way. One SQL function runs a meaning search (pgvector) and a keyword search (full-text search) and merges the two lists (Reciprocal Rank Fusion).
4. **Answer:** the top passages are numbered and sent to Gemini with strict rules: use only these passages, cite them, say "not in your notes" if they don't contain the answer. The answer is streamed to the browser word by word.

This is called RAG (Retrieval-Augmented Generation).

## Tech stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Backend:** FastAPI (Python 3.12), SQLAlchemy, Pydantic
- **Database:** PostgreSQL 17 with pgvector
- **Embeddings:** Qwen3-Embedding-0.6B (runs locally, GPU if available)
- **AI model:** Google Gemini (3.8 Flash, with 3.5 Flash-Lite as fallback)
- **PDF reading:** PyMuPDF
- **Auth:** JWT in an httpOnly cookie, passwords hashed with Argon2id, Student and Admin roles

## Database

The database does real work, not just storage:

- **Tables:** users, courses, materials, document_pages, document_chunks, chat_sessions, chat_messages, message_sources
- **Constraints:** primary and foreign keys, UNIQUE, and CHECK rules (e.g. a failed file must have an error message, an answer must have a status)
- **Indexes:** B-tree on foreign keys, GIN for full-text search, HNSW for vector search, partial indexes for the background work queues
- **Views:** course and file overviews, and four admin views that only contain counts
- **Stored functions:** hybrid search, empty-chat cleanup
- **Triggers:** keep `updated_at` correct, record processing times, mark a chat as active when a message is added
- **Transactions:** a question and its answer are saved together or not at all; a file's passages become visible in one commit
- **Roles:** admin pages read the database as a read-only role that can only see the admin views

Schema changes are numbered migrations in `database/migrations/`. `database/schema.sql` is the full schema for a fresh install.

## Run it locally

You need Python 3.12, Node.js 20+, PostgreSQL 17 with pgvector, and a Gemini API key from [Google AI Studio](https://aistudio.google.com).

**1. Database**

```bash
createdb studymate
psql -d studymate -f database/schema.sql
```

**2. Backend** (from the project folder)

```bash
python -m venv backend/venv
# Windows: backend\venv\Scripts\Activate.ps1   Mac/Linux: source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

With an NVIDIA GPU, install PyTorch's GPU build first (see `backend/requirements.txt`).

Copy `.env.example` to `backend/.env` and fill in `DATABASE_URL`, `JWT_SECRET_KEY` and `GEMINI_API_KEY`. Then:

```bash
python -m uvicorn backend.app.main:app --reload --port 8001
```

The first start downloads the embedding model (about 1.2 GB). API docs: http://localhost:8001/docs

**3. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and create an account.

**Admin account:** every new account is a student. To make one an admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Project structure

```text
backend/
  app/routers/      API routes (auth, courses, materials, search, chat, admin)
  app/processing/   PDF reading, chunking, embeddings, Gemini, RAG
  scripts/          check scripts (search quality, admin API)
database/
  schema.sql        full schema
  migrations/       numbered schema changes
frontend/
  src/app/          pages (dashboard, courses, ask, admin)
  src/components/   UI parts
docs/               notes on every decision and why it was made
```

## Limitations

- PDFs only.
- Gemini's free tier allows only a few requests per day, so picture reading and the chat can pause until the limit resets.
- Text read from pictures can contain mistakes (handwriting especially). Every answer shows its source page so it can be checked.
- Answers are written by an AI model and can still be wrong. The citations are there so you can check them.
- Built to run as one backend process. Running several would need the daily request counter moved into the database.

## Status

Working: accounts and roles, courses, uploads and reading (text and pictures), hybrid search, the chat with citations, the admin dashboard.

Next: measuring answer quality on real notes and automated tests, then THE DEPLOYMENT ONLINE!!
