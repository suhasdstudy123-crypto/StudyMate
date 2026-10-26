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

## Stage 4 — Courses page

- **`lib/courses.ts`** holds the `Course` type and one function per request (list, create, update, delete). Pages never build URLs themselves.
- **Native `<dialog>` instead of a dialog library.** `showModal()` already gives the backdrop, Esc to close, a focus trap and focus returning to the opening button. `components/ui/dialog.tsx` only connects React's `open` prop to it. React's `autoFocus` runs before `showModal()` (while the dialog is hidden) and is lost, so the first field is marked `data-autofocus` and focused after `showModal()`.
- **One form for create and edit** (`course-form-dialog.tsx`), so the rules can't drift apart. Client checks mirror `CourseCreate`; the backend checks again. 409 → "You already have a course with this name" on the name field.
- **The list is updated from the server's answer** (the saved course it returns), not by reloading everything or guessing.
- **Delete asks first and says what will be lost**, using `material_count` from the view. "Keep it" is focused by default, so pressing Enter by accident doesn't delete.
- **Course cards are notebooks:** a ballpoint spine with binding holes, ruled lines (`.ruled`), course code as a label. Edit/delete icons appear on hover with a mouse, are always visible on touch screens (`@media (hover: hover)`), and show on keyboard focus.
- **Data loading in an effect** sets state only when the answer arrives, with an `alive` flag to ignore late answers. "Try again" bumps a counter that re-runs the effect. (ESLint's `react-hooks/set-state-in-effect` rule flags setting state synchronously inside an effect, because that causes an extra render.)
- **Dashboard** ticks "Make your first course" from real data and shows the 3 most recent courses.

## Stage 5a — Uploads through the forwarder

- **`experimental.proxyClientMaxBodySize: "60mb"` in `next.config.ts`.** Next.js reads at most 10 MB of a request body before forwarding it; a 35 MB PDF was cut off and the browser got a 500 ("socket hang up" in the Next terminal). 60 MB is a bit above the backend's 50 MB, so oversized files still get FastAPI's clear 413 message.

## Stage 5a (part 2) — Course page, uploads, "What StudyMate read"

- **`/courses/[id]`** is a dynamic route: one page file for every course; `useParams()` reads the id. 404 from the backend (not yours / doesn't exist) shows "Course not found".
- **Course cards are links** with the *stretched link* pattern: the title's `<Link>` has an `::after` covering the card, edit/delete buttons sit above it (`relative z-10`). A button inside a link would be invalid HTML.
- **Uploads use `XMLHttpRequest`, not `fetch`**, because only XHR reports upload progress (`xhr.upload.onprogress`). The body is `FormData`; the browser sets the multipart `Content-Type` (with its boundary) itself. `errorFromResponse()` in `lib/api.ts` is shared so XHR errors read the same as fetch errors. Uploads run one at a time; each can be cancelled (`xhr.abort()`).
- **Checked in the browser first** (PDF? empty? > 50 MB?) for instant feedback; the backend checks again.
- **Polling:** while any file is `pending`/`processing`, the page re-fetches the file list every 1.5 s, and stops when all are done or the page is left (cleanup clears the interval). A ref holds the latest list so the timer can announce "X is ready" to screen readers without restarting.
- **One row component, five states:** uploading % → queued (sliding bar) → "Reading page x of y" → ready (pages · passages · tables) → failed (reason + Retry). Ready files with `vision_page_count > 0` say plainly how many pages have pictures StudyMate can't read yet.
- **"What StudyMate read"** dialog: page list (table and picture markers) + that page's passages, exactly as stored. Text from notes in the serif font; table chunks parsed from markdown into a real `<table>`.
- **Rename** (`PATCH /materials/{id}`) changes only the display title; delete is disabled while a file is being read (the backend would answer 409).
- **Grid blowout fix:** a CSS grid column is never narrower than its widest content by default, so on phones the page and the viewer were wider than the screen. `grid-cols-1` / `minmax(0, 1fr)` lets the column shrink. On phones the file actions wrap onto their own line (no hover, so all are visible).

## Stage 5b — Page pictures in "What StudyMate read"

- Passages are numbered per page ("Passage 2 of 3"), not by the file-wide index.
- **Themed scrollbars:** `scrollbar-color` on `<html>` (inherited by every scroll area) with the soft ink token, transparent track; `scrollbar-width: thin` inside the page. Safari fallback with `::-webkit-scrollbar` inside `@supports not (scrollbar-color: auto)`.
- Pages the image reader reads show **the page picture** (exactly what the reader is sent), with a skeleton while loading and "Full size" to zoom into screenshot text. A plain `<img>`, not `next/image`: `next/image` downloads on the server without the login cookie.
- A status note per page: waiting / being read / read / failed. Thorough-mode pages without pictures say so.
- Passages written by the image reader carry a **"Read from an image — check it"** label (dashed outline in ink, not highlighter yellow: yellow is reserved for cited text). Diagram passages get their own icon.

## Stage 5b — step 2: picture reading in the UI

- **Smart / Thorough** picker under the upload box: real radio buttons in a `<fieldset>` styled as a switch (arrow keys, screen readers for free). Remembered in `localStorage` (read after the first render to avoid a hydration mismatch; wrapped in try/catch for blocked storage). Sent as a second form field `mode`.
- **File row, picture reading:** "Reading pictures · 7 of 19 pages" + bar / paused ("today's free limit is used up. Continues at 12:30 PM", time from the server in UTC, shown with `Intl.DateTimeFormat` in local time) / off or setup problem / "N pages couldn't be read · Try again" / "19 pages read from pictures". The text is searchable meanwhile, and the row says so.
- **Polling:** 1.5 s while a file's text is read, 5 s while only pictures are (that takes minutes), plus `GET /vision/status` on each tick.
- **Viewer:** page-list icon per page status (waiting / being read / read / failed); refreshes every 5 s while pages are waiting (a `tick` counter in both effects' dependencies, so no loading flicker); failed pages show the reason; ``` blocks render as `<pre>` (exact characters, scrolls sideways on phones); image-reader text keeps its line breaks (`whitespace-pre-line`).
- **Try again in the viewer:** a failed page's note has its own Try again button (students look for it where the problem is shown, not only on the file row). It retries every failed page of the file and tells the course page through `onChanged`, so the file row switches to "Reading pictures…" at once.

## Stage 6 — "Search your notes"

- **Where:** on the course page, between the header and the upload box, as soon as the course has searchable passages (`stats.passages > 0`). Search is the main thing to do once files are read.
- **`lib/search.ts`:** `searchCourse(courseId, q, k)` → `GET /api/courses/{id}/search` (query string built with `URLSearchParams`, so `? & #` and spaces are encoded safely). Types mirror `SearchHit` / `SearchResponse` in schemas.py.
- **`components/search/search-panel.tsx`:** search on Enter/button, not on every keystroke (each search embeds the question: ~0.05 s GPU, ~0.3 s CPU; half-typed questions would waste that). Escape or ✕ clears. A request counter (`latest` ref) makes sure an older, slower answer can't replace a newer one.
- **Result card:** rank number, file, page, type (table/diagram), the same "Read from an image — check it" label as the viewer, and chips showing HOW it was found ("meaning #2", "keywords #1", with a tooltip and screen-reader text). Makes hybrid search visible, and explains why a passage without the exact words can still rank first. Passage in the serif "your documents" font; the question's words in **bold + ink underline** via a rough stem match (`queryStems`), not the yellow highlighter (reserved for text the chat cites). Long passages/tables are faded with a CSS mask + "Show all". Tables and ``` code blocks reuse `MarkdownTable` / `splitFences` from the viewer (now exported).
- **"Open page N"** opens "What StudyMate read" at that page with the passage marked "From your search" (ring) and scrolled into view. `PagesDialog` got `initialPage` + `focusChunkId`; the viewer's `key` includes them so it starts fresh; the page list scrolls to the current page. Bug found in the sandbox: the page picture loads after the passages and pushed the marked one out of view → it scrolls again when the picture's `onLoad` fires.
- **Honest weak results:** meaning search ALWAYS returns its nearest passages, even for a question the notes don't cover ("quantum entanglement" still got 8 results). If none of the results contains any of the question's words, a note with Marky says they're only the closest in meaning and the notes may not cover it. (The Stage 7 chat makes the final "not in your notes" call.)
- **Other states:** loading skeletons; error message; "Meaning search is still warming up" when the backend answered in keywords-only mode (model loading after a restart); Marky (confused) when there are no results at all.
- **Tested** (sandbox, Playwright, built app + backend with a fake model): paraphrase search, exact term, picture passage label, open page 26 from a result (page list + marked passage in view), weak-match note, Escape clears, Pixel 7 dark mode without horizontal scroll; lint, types and `next build` clean.
