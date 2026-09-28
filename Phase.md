# StudyMate — DBMS Mini Project

## 2-Person Development Plan

StudyMate is an AI-powered study assistant that allows students to upload study materials, ask questions, and receive answers generated using Retrieval-Augmented Generation (RAG).

The project uses PostgreSQL as the main database and `pgvector` for storing and searching document embeddings.

---

# 1. Project Architecture

```text
                         STUDENT
                            |
                            v
                    +---------------+
                    |    Next.js    |
                    |   Frontend    |
                    +-------+-------+
                            |
                       REST API / JSON
                            |
                            v
                    +---------------+
                    |    FastAPI    |
                    |    Backend    |
                    +-------+-------+
                            |
             +--------------+---------------+
             |              |               |
             v              v               v
       PostgreSQL       pgvector            LLM
             |              |               |
             +--------------+---------------+
                            |
                       RAG Pipeline
                            |
                            v
                       Final Answer
```

---

# 2. Team Responsibilities

## Member 1 — Backend, Database & RAG

Member 1 is responsible for:

* PostgreSQL
* pgvector
* Database schema
* FastAPI backend
* Authentication APIs
* Course APIs
* Material APIs
* PDF processing
* Text chunking
* Embedding generation
* Vector similarity search
* RAG pipeline
* LLM integration
* Chat APIs
* Chat history APIs
* Backend testing
* API documentation

---

## Member 2 — Frontend & UI

Member 2 is responsible for:

* Next.js setup
* Application layout
* Login page
* Registration page
* Dashboard
* Course interface
* Study material interface
* PDF upload interface
* Chat interface
* Chat history interface
* Source display
* Loading states
* Error states
* Frontend API integration
* Frontend testing
* UI documentation

---

# 3. Repository Structure

```text
StudyMate/
│
├── backend/
│   ├── app/
│   ├── requirements.txt
│   └── .env
│
├── frontend/
│   ├── app/
│   ├── components/
│   └── package.json
│
├── database/
│   ├── schema.sql
│   └── seed.sql
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── api.md
│   └── diagrams/
│
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

# 4. Git Workflow

The `main` branch should always contain working code.

Do not directly develop on `main`.

## Member 1

```bash
git checkout -b feature/backend-setup
```

## Member 2

```bash
git checkout -b feature/frontend-setup
```

For additional features, create separate branches.

Examples:

```text
feature/database
feature/rag
feature/chat-api
feature/login-ui
feature/dashboard
feature/chat-ui
```

Development workflow:

```text
Create branch
     |
     v
Write code
     |
     v
Test locally
     |
     v
Commit
     |
     v
Push
     |
     v
Pull Request
     |
     v
Review
     |
     v
Merge into main
```

After `main` changes:

```bash
git checkout main
git pull origin main
```

---

# 5. PHASE 0 — Project Initialization

## Member 1

* Create backend directory
* Create database directory
* Set up Python environment
* Set up FastAPI
* Create `/health` endpoint
* Create `.env.example`
* Update `.gitignore`

## Member 2

* Create frontend directory
* Set up Next.js
* Create basic application layout
* Create initial pages
* Set up frontend dependencies

### Expected structure

```text
StudyMate/
├── backend/
├── frontend/
├── database/
├── docs/
├── .gitignore
├── .env.example
└── README.md
```

### Definition of Done

Backend:

```text
GET /health
```

returns:

```json
{
  "status": "ok"
}
```

Frontend:

```text
http://localhost:3000
```

loads successfully.

---

# 6. PHASE 1 — PostgreSQL + pgvector

## Member 1

Set up PostgreSQL.

Enable the vector extension:

```sql
CREATE EXTENSION vector;
```

Test:

```sql
SELECT '[1,2,3]'::vector;
```

Verify that PostgreSQL and pgvector are working.

## Member 2

No implementation required.

Review the database requirements and understand how the frontend will consume the database through APIs.

### Definition of Done

PostgreSQL is running and `pgvector` is enabled.

---

# 7. PHASE 2 — Database Design

## Both Members

Agree on the database schema before implementation.

Recommended entities:

```text
USER
 |
 +----------+
 |          |
 v          v
COURSE   CHAT_SESSION
 |
 v
MATERIAL
 |
 v
DOCUMENT_CHUNK
```

Chat:

```text
CHAT_SESSION
     |
     v
CHAT_MESSAGE
```

Recommended tables:

```text
users
courses
materials
document_chunks
chat_sessions
chat_messages
```

## Member 1

* Create `schema.sql`
* Create primary keys
* Create foreign keys
* Create indexes
* Create vector column
* Define relationships
* Create seed data if required

## Member 2

Review the schema based on frontend requirements.

Check that the API will provide everything required by:

* Dashboard
* Courses
* Materials
* Chat
* Chat history

### Definition of Done

The database can be created from `schema.sql` on a fresh PostgreSQL installation.

---

# 8. PHASE 3 — Backend Database Connection

## Member 1

Create:

```text
backend/app/
├── main.py
├── database.py
├── models/
└── schemas/
```

Implement:

```text
FastAPI
   |
   v
Database Layer
   |
   v
PostgreSQL
```

Test:

```text
FastAPI → PostgreSQL
```

using a simple database query.

## Member 2

No implementation required.

### Definition of Done

FastAPI can successfully connect to PostgreSQL.

---

# 9. PHASE 4 — Authentication

## Member 1

Implement:

```text
POST /api/auth/register
POST /api/auth/login
```

Responsibilities:

* User registration
* Password hashing
* Login verification
* Authentication
* Protected API access

## Member 2

Implement:

```text
/login
/register
```

Build:

* Registration form
* Login form
* Authentication state
* Logout
* Protected dashboard

### Integration Checkpoint 1

```text
Next.js Login
      |
      v
FastAPI
      |
      v
PostgreSQL
```

The user should be able to register and log in using the real backend.

---

# 10. PHASE 5 — Course Management

## Member 1

Implement:

```text
POST /api/courses
GET  /api/courses
GET  /api/courses/{id}
```

Optional:

```text
PUT /api/courses/{id}
DELETE /api/courses/{id}
```

## Member 2

Create:

```text
Dashboard
     |
     v
My Courses
     |
     +---- DBMS
     +---- Operating Systems
     +---- Computer Networks
```

### Integration Checkpoint 2

The frontend must retrieve courses from the actual backend/database.

No permanent dummy course data should remain.

---

# 11. PHASE 6 — Study Material Management

## Member 1

Implement:

```text
POST /api/materials/upload
GET  /api/materials
DELETE /api/materials/{id}
```

Store:

* Material title
* Course
* File information
* Upload timestamp
* Other required metadata

## Member 2

Build:

```text
Materials Page
      |
      v
Upload PDF
      |
      v
Upload Progress
      |
      v
Material List
```

---

# 12. PHASE 7 — PDF Processing

## Member 1

Implement:

```text
PDF
 |
 v
Text Extraction
 |
 v
Text Cleaning
 |
 v
Page Tracking
 |
 v
Chunking
```

Each chunk should retain useful metadata.

Example:

```text
material_id
page_number
chunk_index
chunk_text
```

## Member 2

No major implementation required.

The frontend should show upload status.

---

# 13. PHASE 8 — Embeddings

## Member 1

Implement:

```text
Text Chunk
    |
    v
Embedding Model
    |
    v
Vector
```

Store the vector in PostgreSQL using `pgvector`.

Example table:

```text
document_chunks
--------------------------
id
material_id
page_number
chunk_index
chunk_text
embedding
```

The vector dimension must match the selected embedding model.

---

# 14. PHASE 9 — Vector Similarity Search

## Member 1

Implement semantic search using pgvector.

Flow:

```text
Student Question
      |
      v
Question Embedding
      |
      v
PostgreSQL + pgvector
      |
      v
Similarity Search
      |
      v
Top-K Relevant Chunks
```

Example:

```text
Question:
"What is 3NF?"

Top-K:

1. 3NF definition
2. Normalization notes
3. Functional dependencies
4. 2NF vs 3NF
5. Normal forms
```

Conceptual SQL:

```sql
SELECT
    chunk_text,
    page_number
FROM document_chunks
ORDER BY embedding <=> :query_embedding
LIMIT 5;
```

### Definition of Done

A question can be converted into an embedding and used to retrieve relevant chunks from PostgreSQL.

---

# 15. PHASE 10 — RAG Pipeline

## Member 1

Implement:

```text
Question
   |
   v
Embedding
   |
   v
pgvector
   |
   v
Top-K Chunks
   |
   v
Prompt Construction
   |
   v
LLM
   |
   v
Answer
```

The prompt should contain:

```text
System instructions
+
Retrieved study material
+
Student question
```

The LLM should use the retrieved study material as context.

---

# 16. PHASE 11 — LLM Integration

## Member 1

Create a separate service:

```text
backend/app/services/llm.py
```

Responsibilities:

* Build prompt
* Send prompt to LLM
* Receive response
* Handle errors
* Return generated answer

Do not put LLM logic directly inside API routes.

---

# 17. PHASE 12 — RAG Service

## Member 1

Create:

```text
backend/app/services/
├── document_processor.py
├── embeddings.py
├── vector_search.py
├── rag.py
└── llm.py
```

The RAG service should coordinate:

```text
Question
 ↓
Embedding
 ↓
Vector Search
 ↓
Top-K
 ↓
Prompt
 ↓
LLM
 ↓
Answer
```

---

# 18. PHASE 13 — Chat API

## Member 1

Create:

```text
POST /api/chat
```

Request:

```json
{
  "question": "What is 3NF?",
  "course_id": 1
}
```

Response:

```json
{
  "answer": "Third Normal Form is...",
  "sources": [
    {
      "material_id": 5,
      "title": "DBMS Notes.pdf",
      "page": 12
    }
  ]
}
```

This API is the primary connection between Member 1 and Member 2.

---

# 19. PHASE 14 — First Complete RAG Integration

## Both Members

Member 2 creates the chat UI.

```text
+--------------------------------+
| Ask your question              |
|                                |
| What is 3NF?             Send  |
+--------------------------------+
```

Frontend sends:

```text
POST /api/chat
```

Backend performs:

```text
Question
 ↓
Embedding
 ↓
pgvector
 ↓
Top-K
 ↓
LLM
 ↓
Answer
```

Frontend displays:

```text
StudyMate:

Third Normal Form is...

Sources:
DBMS Notes.pdf — Page 12
```

### Integration Checkpoint 3 — CORE MILESTONE

The following must work:

```text
Next.js
   |
   v
FastAPI
   |
   v
PostgreSQL + pgvector
   |
   v
LLM
   |
   v
FastAPI
   |
   v
Next.js
```

At this point the core StudyMate RAG system is operational.

---

# 20. PHASE 15 — Chat History

## Member 1

Create:

```text
chat_sessions
chat_messages
```

APIs:

```text
POST /api/chat
GET  /api/chat/history
GET  /api/chat/{session_id}
```

Store:

* User
* Session
* Question
* Answer
* Timestamp

## Member 2

Create:

```text
Recent Chats
```

and conversation pages.

Example:

```text
Recent Chats

• What is normalization?
• Explain 3NF
• What is a foreign key?
```

---

# 21. PHASE 16 — Source References

## Member 1

Return source information with every answer.

Example:

```json
{
  "answer": "Normalization is...",
  "sources": [
    {
      "title": "DBMS Unit 3.pdf",
      "page": 14
    },
    {
      "title": "DBMS Unit 3.pdf",
      "page": 15
    }
  ]
}
```

## Member 2

Display:

```text
Sources

DBMS Unit 3.pdf
Page 14

DBMS Unit 3.pdf
Page 15
```

---

# 22. PHASE 17 — Course-Aware Retrieval

## Member 1

Restrict vector search based on the selected course.

```text
Question
   |
   v
Question Embedding
   |
   v
Course Filter
   |
   v
pgvector Search
   |
   v
Top-K Relevant Chunks
```

This prevents DBMS questions from retrieving unrelated Operating Systems material.

## Member 2

Ensure the current course is sent with the chat request.

Example:

```json
{
  "question": "What is normalization?",
  "course_id": 1
}
```

---

# 23. PHASE 18 — Frontend Polish

## Member 2

Improve:

* Dashboard
* Navigation
* Course pages
* Materials page
* Chat page
* Chat history
* Login
* Registration
* Loading states
* Error messages
* Empty states
* Responsive layout

## Member 1

Improve backend API responses and error handling so the frontend can handle these states properly.

---

# 24. PHASE 19 — Backend Error Handling

## Member 1

Handle:

```text
Invalid PDF
Empty PDF
Embedding failure
LLM failure
Database failure
No relevant chunks
Invalid course
Invalid request
Unauthorized request
```

Example:

```json
{
  "error": "No relevant study material was found."
}
```

## Member 2

Display appropriate user-friendly messages.

---

# 25. PHASE 20 — RAG Testing

## Member 1

Create a test set.

Example:

```text
What is normalization?
What is 1NF?
What is 2NF?
What is 3NF?
What is a primary key?
What is a foreign key?
```

For each question check:

```text
Question
   |
   v
Retrieved chunks
   |
   v
Are chunks relevant?
   |
   v
LLM answer
   |
   v
Does answer match source?
```

---

# 26. PHASE 21 — Database Testing

## Member 1

Test:

* User creation
* Course creation
* Material insertion
* Chunk insertion
* Vector insertion
* Vector search
* Chat storage
* Foreign keys
* Delete operations
* Course filtering

---

# 27. PHASE 22 — Frontend Testing

## Member 2

Test:

* Registration
* Login
* Logout
* Dashboard
* Course selection
* PDF upload
* Chat
* Source display
* Chat history
* Error states
* Loading states

---

# 28. PHASE 23 — End-to-End Testing

## Both Members

Test the entire student journey:

```text
Register
   ↓
Login
   ↓
Dashboard
   ↓
Select Course
   ↓
Upload PDF
   ↓
Process PDF
   ↓
Generate Embeddings
   ↓
Store in pgvector
   ↓
Ask Question
   ↓
Retrieve Top-K
   ↓
Generate LLM Answer
   ↓
Display Answer
   ↓
Display Sources
   ↓
Save Chat
   ↓
Open Chat History
```

---

# 29. PHASE 24 — Documentation

## Member 1

Document:

* Database architecture
* ER diagram
* PostgreSQL
* pgvector
* Backend architecture
* RAG pipeline
* LLM integration
* API documentation

## Member 2

Document:

* Frontend architecture
* Pages
* Components
* User flow
* UI design
* Frontend API integration

## Both

Document:

* Problem statement
* Objectives
* Technology stack
* System architecture
* Implementation
* Testing
* Results
* Limitations
* Future scope

---

# 30. PHASE 25 — Final Diagrams

The project should contain:

## System Architecture

```text
Student
   ↓
Next.js
   ↓
FastAPI
   ↓
PostgreSQL + pgvector
   ↓
LLM
```

## ER Diagram

```text
USER
 |
 +-------- COURSE
 |
 +-------- CHAT_SESSION
              |
              +-------- CHAT_MESSAGE

COURSE
 |
 +-------- MATERIAL
              |
              +-------- DOCUMENT_CHUNK
```

## RAG Diagram

```text
Question
   ↓
Embedding
   ↓
Vector Search
   ↓
Top-K Chunks
   ↓
Prompt
   ↓
LLM
   ↓
Answer
```

## Sequence Diagram

```text
Student
   |
   v
Frontend
   |
   v
Backend
   |
   +----> Embedding Model
   |
   +----> PostgreSQL / pgvector
   |
   +----> LLM
   |
   v
Backend
   |
   v
Frontend
   |
   v
Student
```

---

# 31. PHASE 26 — Final Git Cleanup

Before submission, ensure:

## Do NOT commit

```text
.env
.venv/
node_modules/
__pycache__/
API keys
Passwords
Secrets
```

## DO commit

```text
.env.example
requirements.txt
package.json
schema.sql
seed.sql
README.md
Source code
Documentation
Diagrams
```

---

# 32. PHASE 27 — Final README

The final README should contain:

1. Project Overview
2. Problem Statement
3. Objectives
4. Features
5. Architecture
6. Technology Stack
7. Database Design
8. RAG Pipeline
9. Installation
10. Environment Variables
11. Backend Setup
12. Frontend Setup
13. Database Setup
14. API Documentation
15. Testing
16. Team Contributions
17. Limitations
18. Future Scope

---

# 33. PHASE 28 — Final Demonstration

The final demo should follow this sequence:

```text
1. Open StudyMate
       ↓
2. Register
       ↓
3. Login
       ↓
4. Open DBMS course
       ↓
5. Upload DBMS PDF
       ↓
6. Show material stored
       ↓
7. Ask:
   "What is 3NF?"
       ↓
8. Show generated answer
       ↓
9. Show source/page
       ↓
10. Ask another question
       ↓
11. Open chat history
       ↓
12. Show database/RAG architecture
```

---

# 34. Final Team Milestones

## Milestone 1 — Foundation

### Member 1

```text
FastAPI
PostgreSQL
pgvector
```

### Member 2

```text
Next.js
Basic UI
```

---

## Milestone 2 — Database

### Member 1

```text
Schema
Models
Relationships
Database APIs
```

### Member 2

```text
Course UI
Dashboard
```

---

## Milestone 3 — Document Pipeline

### Member 1

```text
PDF
 ↓
Text
 ↓
Chunks
 ↓
Embeddings
 ↓
pgvector
```

### Member 2

```text
Material Upload UI
Material List
```

---

## Milestone 4 — RAG

### Member 1

```text
Question
 ↓
Embedding
 ↓
Top-K
 ↓
Prompt
 ↓
LLM
 ↓
Answer
```

### Member 2

```text
Chat UI
```

---

## Milestone 5 — Integration

```text
Next.js
   ↕
FastAPI
   ↕
PostgreSQL + pgvector
   ↕
LLM
```

---

## Milestone 6 — Final Application

```text
Authentication
+
Courses
+
Materials
+
RAG Chat
+
Sources
+
Chat History
+
Testing
+
Documentation
```

---

# 35. Critical Integration Rules

### Rule 1

Never commit API keys.

### Rule 2

Never directly modify `main` during normal development.

### Rule 3

Every feature must be tested before creating a Pull Request.

### Rule 4

Member 1 and Member 2 must agree on API request/response formats.

### Rule 5

The frontend must never directly access PostgreSQL.

Correct:

```text
Next.js → FastAPI → PostgreSQL
```

Incorrect:

```text
Next.js → PostgreSQL
```

### Rule 6

Keep RAG logic inside backend services.

### Rule 7

Integrate after every major milestone instead of waiting until the end.

---

# 36. Most Important Integration Points

There are three major integration checkpoints.

## Checkpoint 1 — Authentication

```text
Next.js
   ↓
FastAPI
   ↓
PostgreSQL
```

---

## Checkpoint 2 — Materials

```text
Next.js
   ↓
FastAPI
   ↓
PDF Processing
   ↓
PostgreSQL
```

---

## Checkpoint 3 — RAG ⭐

```text
Next.js
   ↓
FastAPI
   ↓
Embedding
   ↓
pgvector
   ↓
Top-K
   ↓
LLM
   ↓
FastAPI
   ↓
Next.js
```

**Checkpoint 3 is the core StudyMate demonstration.**

---

# 37. Final Definition of Done

StudyMate is considered complete when a student can:

```text
✓ Register
✓ Login
✓ Select a course
✓ Upload study material
✓ Material is processed
✓ Text is chunked
✓ Embeddings are generated
✓ Embeddings are stored in pgvector
✓ Ask a question
✓ Retrieve Top-K relevant chunks
✓ Generate an LLM answer using retrieved context
✓ See the answer in the frontend
✓ See source material/page information
✓ Continue the conversation
✓ View chat history
✓ Log out
```

And technically:

```text
✓ PostgreSQL works
✓ pgvector works
✓ FastAPI works
✓ Next.js works
✓ Frontend ↔ Backend works
✓ Backend ↔ Database works
✓ RAG works
✓ LLM works
✓ Authentication works
✓ APIs are documented
✓ Tests pass
✓ No secrets are committed
✓ README is complete
✓ Architecture diagrams are complete
```

---

# 38. Current Starting Point

You are currently here:

```text
PHASE 0
   ↓
Project Repository
   ↓
PHASE 1
   ↓
Backend + Frontend Foundation
```

### Member 1 — You

Start with:

```text
1. Create backend branch
2. Set up Python environment
3. Install FastAPI
4. Create backend/app/main.py
5. Create /health
6. Run FastAPI
7. Commit
8. Push branch
```

### Member 2

At the same time:

```text
1. Create frontend branch
2. Set up Next.js
3. Create basic layout
4. Create initial pages
5. Run Next.js
6. Commit
7. Push branch
```

**Do not move to RAG yet.**

Once both foundations are working, move together to **Phase 1: PostgreSQL + pgvector**, then continue phase-by-phase.

This README should be your team's **master development checklist** throughout the project.
