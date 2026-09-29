# StudyMate

An AI-powered study assistant: students upload study material and ask questions
answered via Retrieval-Augmented Generation (RAG). See Phase.md in this repo for
the full team plan, architecture, and phase-by-phase checklist.

Stack:
- frontend/ = Next.js (TypeScript, Tailwind, App Router, src/ directory)
- backend/  = FastAPI (Python) — auth, courses, materials, PDF processing,
              embeddings, vector search, RAG pipeline, LLM integration, chat
- database/ = PostgreSQL + pgvector (schema.sql, seed.sql)

The frontend NEVER talks to PostgreSQL directly. All data flows through the
FastAPI backend: Next.js -> FastAPI -> PostgreSQL.

## Role
You are the implementer. Architecture, design decisions, and teaching happen
elsewhere. I will give you a specific implementation brief for each step.

## Rules
- Implement exactly what the brief says. Nothing extra, nothing from future phases.
- Show a short plan and wait for approval before editing files.
- If the brief is ambiguous or a design decision is needed (schema, library choice,
  folder structure, auth approach), STOP and ask me. Do not decide silently.
- Keep code simple and commented where the logic is not obvious. No clever abstractions.
- After finishing, give a short summary: files created/changed and what each does.
- Never put secrets in code. Use .env files (already in .gitignore).
- Don't run git commit or git push. List the files changed and suggest a commit message.
- If an error occurs, report the exact error and the likely cause before fixing it.

## Current status
Frontend: Phase 0 done and merged to main (placeholder routes + nav for
login, register, dashboard, courses, materials, chat).
Backend: starting Phase 0 (Python env, FastAPI, /health endpoint) on branch
feature/backend-setup. This is now a solo effort — teammate's branch exists
separately and is not currently being integrated.
