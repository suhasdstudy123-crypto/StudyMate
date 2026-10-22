# Frontend Notes

A running log of frontend decisions and why they were made.

## Stage 3B.1 — Design foundation and landing page

- **Design idea: blue ballpoint ink on paper + highlighter yellow.** Yellow is used only for text quoted from the student's own notes, so "yellow" means "this came from your notes".
- **Two fonts with a job.** Schibsted Grotesk is the app's own voice; Source Serif 4 is used for anything quoted from the student's documents.
- **Design tokens in `globals.css`.** Every colour is a CSS variable with a light and a dark value; components only use names like `bg-primary`. Dark mode = next-themes adding `class="dark"` to `<html>`.
- **shadcn/ui-style components** (Button, Input, Label) live in `src/components/ui/`: the source is in the project, not hidden in a library.
- **Fonts from npm (Fontsource)**, served from our own site: no Google request on page load, works offline.
- **Animations with `motion`** (scroll reveals, Marky's poses). Everything respects the OS "reduce motion" setting.
- **Next.js upgraded 16.3.4 → 16.4.2** to fix a critical advisory. The remaining `npm audit` warnings are in ESLint (dev-only, never shipped); `npm audit fix --force` was rejected because it downgrades eslint-config-next to v14.

## Stage 3B.2 — Login, register and protected pages

- **Same-origin forwarding (`next.config.ts` rewrites).** The browser calls `localhost:3000/api/...`; Next.js forwards to FastAPI on `127.0.0.1:8001`. One origin means the auth cookie is first-party and no CORS setup is needed. `127.0.0.1` instead of `localhost` because Node may try IPv6 `::1` first while uvicorn listens on IPv4.
- **The token never touches JavaScript.** The backend sets an httpOnly cookie; the frontend only keeps "who am I" (from `GET /auth/me`) in React Context (`AuthProvider`). An XSS bug can't steal the token.
- **Two guards, one security boundary.**
  1. `src/proxy.ts` (Next 16's new name for middleware): if there's no cookie at all, redirect to `/login?next=...` before rendering. Optimistic only: it can't verify the token.
  2. `src/app/(app)/layout.tsx`: asks the backend `/auth/me`; a 401 (expired/fake token) sends you to login.
  The backend's 401/403 is the real security; the frontend guards are for user experience.
- **Route group `(app)`.** The brackets group dashboard/courses/materials/chat under one layout (auth check + app header) without changing their URLs.
- **Open-redirect protection.** `?next=` is only followed if it's a path on our own site (`/courses`), never `//evil.com`.
- **Client-side validation mirrors the backend rules** (email format, password 8–128) for instant feedback; the backend still validates everything again.
- **Error mapping.** 401 → form message, 409 → "account already exists" on the email field, 422 → messages under each field, no response → "Couldn't reach StudyMate".
