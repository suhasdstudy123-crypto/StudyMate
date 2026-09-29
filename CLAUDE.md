# StudyMate

Coursework knowledge management app: Next.js frontend, PostgreSQL + pgvector,
JWT auth (Student/Admin roles). Level 3 DBMS course project.

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

## Layout
- frontend/ = Next.js app (TypeScript, Tailwind, App Router, src/ directory)
- Planned siblings: database/ (SQL), ml-service/ (Python embeddings, later)

## Current status
Phase 1: Next.js scaffold created in frontend/ (not yet committed).