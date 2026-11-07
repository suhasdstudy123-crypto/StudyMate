# StudyMate — AI-Powered Study Assistant

StudyMate is an AI-powered study assistant designed for college students. Students upload their academic study materials (lecture notes, slide decks, previous-year question papers) as PDFs and ask questions in natural language. StudyMate retrieves the most relevant passages—including both extractable text and visual content like diagrams, flowcharts, screenshots, and tables—and generates grounded, accurate answers accompanied by exact document and page citations.

The system uses **Retrieval-Augmented Generation (RAG)** backed by **PostgreSQL 17** with the **`pgvector`** extension, **FastAPI**, and **Next.js**.

---

## Architecture Overview

```text
                                  STUDENT BROWSER
                                         │
                                         ▼
                               Next.js 16 (App Router)
                            [Port 3000 | TypeScript + Tailwind]
                                         │
                             Internal HTTP Proxy (/api/*)
                                         │
                                         ▼
                                  FastAPI Backend
                           [Port 8001 | Python 3.12 + Uvicorn]
                                         │
                   ┌─────────────────────┼─────────────────────┐
                   │                     │                     │
                   ▼                     ▼                     ▼
          PostgreSQL 17 + pgvector   Local Embeddings      Google Gemini API
          • Users, Courses, Materials • all-MiniLM-L6-v2   • 2.5 Flash / 1.5 Flash
          • Document Pages & Chunks   • 384 dimensions     • Vision: diagram OCR & read
          • HNSW Vector Cosine Index  • SentenceTransformers • RAG: Grounded answers
          • Chat Sessions & Sources
```

### Complete End-to-End Pipeline

1. **PDF Ingestion & Text Extraction (`backend/app/processing/`):**
   - Uploaded PDFs undergo multi-level validation (magic bytes `%PDF-`, PyMuPDF integrity, page count, and duplicate SHA-256 hash checks).
   - `extract.py` cleans text, strips repetitive headers/footers, extracts markdown tables, and flags pages containing diagrams, figures, or complex formulas (`needs_vision`).
   - `chunking.py` splits text into ~900-character chunks with sentence overlap, strictly preserving page boundaries.

2. **Diagram & Visual Processing via Gemini Vision:**
   - Pages flagged with figures or diagrams are rendered as high-resolution PNGs (2000px long side) by `render.py`.
   - `vision_worker.py` dispatches batched requests to Google Gemini Vision with structured JSON output, transcribing terminal code, converting image tables to markdown, and describing nodes/connections of diagrams.

3. **Embedding Generation & Vector Indexing:**
   - Document chunks (both text and vision passages) are converted into 384-dimensional normalized vectors using `sentence-transformers/all-MiniLM-L6-v2` running on CPU.
   - Vectors are stored in the PostgreSQL `document_chunks.embedding` column with an HNSW cosine similarity index (`vector_cosine_ops`).
   - An idempotent, resumable backfill CLI (`backend/app/processing/backfill_embeddings.py`) embeds any legacy unindexed chunks.

4. **Vector Retrieval & RAG Answering:**
   - Questions are embedded using the identical 384-dimensional model.
   - `backend/app/services/retrieval.py` executes cosine similarity queries (`search_chunks`) with strict student ownership isolation and optional course scoping.
   - `backend/app/services/rag.py` constructs a bounded context window, validates similarity thresholds, enforces anti-jailbreak system prompts, and calls Gemini to produce grounded answers with bracketed citation tokens `[doc:TITLE p:PAGE]`.

5. **Chat Session & Source Persistence:**
   - Conversations and messages are persisted in PostgreSQL (`chat_sessions`, `chat_messages`).
   - Retrieved source passages are linked directly in `message_sources`, ensuring transparent, verifiable citations.

---

## Tech Stack

- **Frontend:** Next.js 16 (React 19, TypeScript, Tailwind CSS, Lucide Icons, Fontsource Schibsted Grotesk & Source Serif 4).
- **Backend:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Uvicorn.
- **Database:** PostgreSQL 17 with `pgvector` extension.
- **Embedding Model:** `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions, cosine normalized).
- **LLM & Vision:** Google Gemini 2.5 Flash / 1.5 Flash via `google-genai` SDK.
- **PDF Processing:** PyMuPDF (`fitz`) 1.28.2.
- **Security & Auth:** Argon2id password hashing (`argon2-cffi`), PyJWT with secure httpOnly cookies.

---

## Repository Structure

```text
StudyMate/
├── backend/
│   ├── app/
│   │   ├── config.py              # App settings & validation
│   │   ├── database.py            # SQLAlchemy engine & session factory
│   │   ├── deps.py                # Auth & user dependencies
│   │   ├── main.py                # FastAPI app initialization & lifespans
│   │   ├── models.py              # Database ORM models
│   │   ├── schemas.py             # Pydantic request/response schemas
│   │   ├── security.py            # Argon2 password hashing & JWT management
│   │   ├── storage.py             # Atomic file uploads & path security
│   │   ├── processing/            # PDF ingestion, chunking & vision workers
│   │   │   ├── chunking.py
│   │   │   ├── extract.py
│   │   │   ├── render.py
│   │   │   ├── vision.py
│   │   │   ├── vision_worker.py
│   │   │   ├── worker.py
│   │   │   └── backfill_embeddings.py # Resumable embedding CLI
│   │   ├── routers/               # API endpoints
│   │   │   ├── admin.py
│   │   │   ├── auth.py
│   │   │   ├── chat.py            # Chat session & message endpoints
│   │   │   ├── courses.py         # Course management
│   │   │   ├── materials.py       # PDF upload, listing & page viewer
│   │   │   └── vision.py          # Vision worker status
│   │   └── services/              # Core business logic
│   │       ├── embeddings.py      # 384-dim embedding generator
│   │       ├── llm.py             # Gemini LLM & Mock LLM abstraction
│   │       ├── rag.py             # Grounded RAG orchestrator
│   │       └── retrieval.py       # pgvector cosine similarity search
│   ├── tests/                     # Automated pytest suite (26 tests)
│   └── requirements.txt
├── database/
│   ├── schema.sql                 # Baseline schema with pgvector
│   └── migrations/
│       ├── 001_course_names_case_insensitive.sql
│       ├── 002_document_pages_and_progress.sql
│       ├── 003_vision_reading.sql
│       └── 004_search_chunks_course_optional_and_chunk_type.sql
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (app)/
│   │   │   │   ├── chat/page.tsx       # Interactive RAG chat UI
│   │   │   │   ├── courses/page.tsx    # Course manager
│   │   │   │   ├── materials/page.tsx  # Standalone materials library
│   │   │   │   └── dashboard/page.tsx
│   │   │   └── (auth)/                 # Login & register pages
│   │   ├── components/                 # UI design system & dialogs
│   │   └── lib/                        # API client functions
│   └── package.json
└── docs/
    ├── backend-notes.md
    └── frontend-notes.md
```

---

## Local Setup & Installation

### Prerequisites
- Python 3.10+ (tested on Python 3.12)
- Node.js 18+ and npm
- PostgreSQL 16+ or 17 with the `pgvector` extension installed
- Windows PowerShell or Unix Terminal

---

### 1. Database Setup

Ensure PostgreSQL is running and create the database:
```sql
CREATE DATABASE studymate;
\c studymate
CREATE EXTENSION IF NOT EXISTS vector;
```

Apply the schema and migrations:
```powershell
# In PowerShell:
psql -U postgres -d studymate -f database/schema.sql
psql -U postgres -d studymate -f database/migrations/001_course_names_case_insensitive.sql
psql -U postgres -d studymate -f database/migrations/002_document_pages_and_progress.sql
psql -U postgres -d studymate -f database/migrations/003_vision_reading.sql
psql -U postgres -d studymate -f database/migrations/004_search_chunks_course_optional_and_chunk_type.sql
```

---

### 2. Backend Setup

1. In the repository root, create and activate your Python virtual environment:
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

2. Install backend dependencies:
   ```powershell
   pip install -r backend/requirements.txt
   ```

3. Configure environment variables in `backend/.env` (refer to `.env.example`):
   ```ini
   DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/studymate
   JWT_SECRET_KEY=YOUR_SECURE_RANDOM_SECRET_KEY_AT_LEAST_32_CHARS
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   EMBEDDING_MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
   EMBEDDING_DEVICE=cpu
   CHAT_MODEL=gemini-2.5-flash
   ```

4. Start the FastAPI backend server from the repository root (running on port 8001 to prevent conflicts with local Windows services):
   ```powershell
   python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
   ```

---

### 3. Backfill Existing Embeddings (Optional / Periodic)

To calculate 384-dim embeddings for any chunks uploaded previously without vectors:
```powershell
python -m backend.app.processing.backfill_embeddings
```

---

### 4. Frontend Setup

1. Navigate to the `frontend` directory:
   ```powershell
   cd frontend
   npm install
   ```

2. Start the Next.js development server on port 3000:
   ```powershell
   npm run dev
   ```

3. Open `http://localhost:3000` in your web browser. Next.js automatically rewrites `/api/*` requests to the backend at `http://127.0.0.1:8001`.

---

## Running the Automated Test Suite

The test suite validates backend configuration, embedding generation, vector similarity retrieval, grounded RAG prompts, mock LLM generation, chat sessions, message persistence, source citations, course authorization, and storage security:

```powershell
python -m pytest backend/tests -v
```

All 26 automated unit and integration tests execute completely offline using an in-memory SQLite database and deterministic mocks.

---

## Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Student account registration |
| `POST` | `/auth/login` | Student login (sets httpOnly cookie) |
| `GET` | `/auth/me` | Fetch authenticated student profile |
| `GET` | `/courses` | List courses owned by student with material counts |
| `POST` | `/courses` | Create a new course |
| `POST` | `/materials/upload` | Upload PDF (`smart` or `thorough` vision mode) |
| `GET` | `/materials` | List all materials across all student courses |
| `GET` | `/materials/{id}/pages` | Inspect pages, text passages, and diagram notes |
| `POST` | `/chat/sessions` | Create a new chat session (course scoped or global) |
| `GET` | `/chat/sessions` | List active chat sessions |
| `GET` | `/chat/sessions/{id}` | Get full conversation history with source citations |
| `POST` | `/chat/sessions/{id}/messages` | Ask question, execute RAG retrieval, return answer + sources |
| `DELETE` | `/chat/sessions/{id}` | Delete chat session with cascading message cleanup |
| `POST` | `/chat/quick` | Single-turn stateless RAG inquiry |

---

## Design System

StudyMate uses a signature physical stationery motif:
- **Ink on Paper:** Deep ballpoint blue text on warm off-white ruled paper styling.
- **Highlighter Yellow:** Reserved exclusively for text passages quoted directly from the student's own uploaded notes.
- **Source Serif 4:** Applied strictly to quoted source document excerpts, visually distinguishing the student's study material from generated assistant answers.
