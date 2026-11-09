"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, History, Library, Loader2, MessageSquarePlus, Trash2 } from "lucide-react";

import { ChatThread, type UiMessage } from "@/components/chat/chat-thread";
import { Composer } from "@/components/chat/composer";
import { SourcesPanel } from "@/components/chat/sources-panel";
import { PagesDialog } from "@/components/materials/pages-dialog";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import {
  askQuestion,
  createSession,
  deleteSession,
  getChatStatus,
  getSession,
  getSuggestions,
  listSessions,
  modelLabel,
  type ChatSession,
  type ChatSource,
  type ChatStatus,
  MAX_QUESTION_CHARS,
} from "@/lib/chat";
import { listCourses, timeAgo, type Course } from "@/lib/courses";
import { listMaterials, type Material } from "@/lib/materials";
import { cn } from "@/lib/utils";

/*
  /chat?course=<id>&session=<id>   (Stage 7)

    left    : course picker + this course's chats
    middle  : the conversation + the question box
    right   : the passages behind the selected answer (wide screens;
              smaller screens open them in a dialog)

  The course and chat live in the URL, so a chat can be reloaded,
  bookmarked, or opened from the history later.
*/

// The Sources and Chats dialogs can be long: they scroll inside themselves.
const SCROLLING_DIALOG = "max-w-lg max-h-[calc(100dvh-2rem)] overflow-auto";

// One curve for every movement on the site (same as --ease-soft in globals.css)
const EASE = [0.22, 1, 0.36, 1] as const;

let tempId = 0;
const nextTempId = () => `temp-${++tempId}`;

export default function ChatPage() {
  // useSearchParams needs a Suspense boundary (the URL is only known in the browser).
  return (
    <Suspense fallback={<PageLoading />}>
      <ChatScreen />
    </Suspense>
  );
}

function PageLoading() {
  return (
    // Placeholders shaped like a question and an answer
    <div className="grid gap-4 py-2" role="status" aria-label="Loading">
      <div className="skeleton ml-auto h-10 w-1/2 rounded-lg" />
      <div className="skeleton h-32 rounded-xl" />
    </div>
  );
}

function ChatScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");
  const courseParam = params.get("course");
  // A question handed over from the dashboard's quick-ask box: asked once, automatically.
  const askParam = params.get("ask");

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadedSession, setLoadedSession] = useState<ChatSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeN, setActiveN] = useState<number | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preset, setPreset] = useState<{ text: string; nonce: number } | null>(null);
  const [viewer, setViewer] = useState<{ material: Material; page: number; chunkId: string } | null>(null);
  const [toDelete, setToDelete] = useState<ChatSession | null>(null);
  const [suggestions, setSuggestions] = useState<{ courseId: string; items: string[] } | null>(null);
  const askedFromUrl = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const materialsCache = useRef(new Map<string, Material[]>());
  const bottomRef = useRef<HTMLDivElement>(null);
  // A chat we just created ourselves: don't reload it from the server
  // (the question is already on screen and its answer is streaming).
  const justCreated = useRef<string | null>(null);

  // The course of the open chat wins; otherwise the URL's; otherwise the most
  // recent course that HAS notes (a new empty course shouldn't greet you with
  // "nothing to read"); otherwise the most recent course.
  const courseId =
    (sessionId && loadedSession?.id === sessionId ? loadedSession.course_id : null) ??
    courseParam ??
    courses?.find((c) => c.chunk_count > 0)?.id ??
    courses?.[0]?.id ??
    null;
  const course = courses?.find((c) => c.id === courseId) ?? null;
  const courseDeleted = Boolean(sessionId && loadedSession?.id === sessionId && loadedSession.course_id === null);

  const go = useCallback(
    (next: { course?: string | null; session?: string | null }) => {
      const q = new URLSearchParams();
      if (next.course) q.set("course", next.course);
      if (next.session) q.set("session", next.session);
      router.replace(q.size ? `/chat?${q}` : "/chat", { scroll: false });
    },
    [router],
  );

  // ---- load courses + chat status once ------------------------------------
  useEffect(() => {
    let alive = true;
    listCourses()
      .then((c) => alive && setCourses(c))
      .catch((e) => alive && setLoadError(e instanceof ApiError ? e.message : "Couldn't load your courses."));
    getChatStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ---- this course's chats --------------------------------------------------
  const refreshSessions = useCallback(() => {
    if (!courseId) return;
    listSessions(courseId)
      .then(setSessions)
      .catch(() => {});
  }, [courseId]);
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    listSessions(courseId)
      .then((s) => alive && setSessions(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [courseId]);

  // ---- suggested questions from this course's own headings ------------------
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    getSuggestions(courseId)
      .then((items) => alive && setSuggestions({ courseId, items }))
      .catch(() => alive && setSuggestions({ courseId, items: [] }));
    return () => {
      alive = false;
    };
  }, [courseId]);

  // ---- open a chat from the URL ----------------------------------------------
  useEffect(() => {
    if (!sessionId || justCreated.current === sessionId) return;
    let alive = true;
    abortRef.current?.abort();
    // show the loader while this chat loads
    setLoadingSession(true);
    getSession(sessionId)
      .then((d) => {
        if (!alive) return;
        const { messages: msgs, ...summary } = d;
        setLoadedSession(summary);
        setMessages(msgs);
        const lastAnswer = [...msgs].reverse().find((m) => m.role === "assistant");
        setSelectedId(lastAnswer?.id ?? null);
        setActiveN(null);
      })
      .catch(() => {
        if (alive) go({ course: courseParam });
      })
      .finally(() => alive && setLoadingSession(false));
    return () => {
      alive = false;
    };
  }, [sessionId, courseParam, go]);

  // Leaving a chat ("New chat", other course): clear the screen. Adjusting
  // state while rendering (React's pattern for "reset when a prop changes").
  const [shownSession, setShownSession] = useState(sessionId);
  if (shownSession !== sessionId) {
    setShownSession(sessionId);
    if (!sessionId) {
      setMessages([]);
      setLoadedSession(null);
      setSelectedId(null);
      setActiveN(null);
    }
  }

  // Keep the newest text in view while an answer streams, once more when it
  // finishes (the footer adds height), and jump to the end when a chat opens.
  const lastLength = messages.at(-1)?.content.length ?? 0;
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming || wasStreaming.current) bottomRef.current?.scrollIntoView({ block: "end" });
    wasStreaming.current = streaming;
  }, [streaming, lastLength, messages.length]);
  useEffect(() => {
    if (!loadingSession && sessionId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [loadingSession, sessionId]);

  // ---- update one message (by id) -------------------------------------------
  const patch = useCallback((id: string, change: (m: UiMessage) => Partial<UiMessage>) => {
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...change(m) } : m)));
  }, []);

  // ---- asking ----------------------------------------------------------------
  async function send(question: string) {
    if (!courseId || streaming) return;
    let sid = sessionId;
    const qId = nextTempId();
    const aId = nextTempId();
    const now = new Date().toISOString();
    setMessages((all) => [
      ...all,
      { id: qId, role: "user", content: question, created_at: now, status: null, model: null, search_query: null, sources: [] },
      { id: aId, role: "assistant", content: "", created_at: now, status: null, model: null, search_query: null, sources: [], phase: "searching" },
    ]);
    setSelectedId(aId);
    setActiveN(null);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      if (!sid) {
        const created = await createSession(courseId);
        sid = created.id;
        justCreated.current = sid;
        setLoadedSession(created);
        setSessions((all) => [created, ...all]);
        go({ course: courseId, session: sid });
      }
      await askQuestion(
        sid,
        question,
        {
          onStatus: () => patch(aId, () => ({ phase: "searching" })),
          onSources: (d) => {
            patch(qId, () => ({ search_query: d.search_query }));
            patch(aId, () => ({ sources: d.passages, phase: "reading" }));
          },
          onDelta: (t) => patch(aId, (m) => ({ content: m.content + t, phase: "writing" })),
          onDone: (d) => {
            const cited = new Set(d.cited);
            setMessages((all) =>
              all.map((m) =>
                m.id === qId
                  ? { ...m, id: d.question_id }
                  : m.id === aId
                    ? {
                        ...m,
                        id: d.message_id,
                        content: d.text,
                        status: d.status,
                        model: d.model,
                        phase: undefined,
                        sources: m.sources.map((s) => ({ ...s, cited: cited.has(s.n) })),
                      }
                    : m,
              ),
            );
            setSelectedId((sel) => (sel === aId ? d.message_id : sel));
          },
          onError: (e) => patch(aId, () => ({ phase: undefined, error: { ...e, question } })),
        },
        ctrl.signal,
      );
    } catch (err) {
      if (ctrl.signal.aborted) {
        // Stop: the server keeps what was shown (status "stopped"); mirror that here.
        setMessages((all) => {
          const answer = all.find((m) => m.id === aId);
          if (!answer?.content.trim()) return all.filter((m) => m.id !== qId && m.id !== aId);
          return all.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  phase: undefined,
                  status: "stopped",
                  sources: m.sources.map((s) => ({ ...s, cited: m.content.includes(`[${s.n}]`) })),
                }
              : m,
          );
        });
      } else {
        const message = err instanceof ApiError ? err.message : "Something went wrong. Please ask again.";
        patch(aId, () => ({ phase: undefined, error: { reason: "failed", message, available_at: null, question } }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      refreshSessions();
      getChatStatus()
        .then(setStatus)
        .catch(() => {});
    }
  }

  // Dashboard quick-ask: /chat?course=…&ask=… asks that question once.
  useEffect(() => {
    if (!askParam || askedFromUrl.current || !courses || !courseId || sessionId) return;
    askedFromUrl.current = true;
    const question = askParam.trim().slice(0, MAX_QUESTION_CHARS);
    // after this render (send() updates state, and the effect shouldn't do that directly)
    const t = setTimeout(() => {
      if (question) void send(question);
      else go({ course: courseId });
    }, 0);
    return () => clearTimeout(t);
    // send() is a plain function recreated every render; the ref makes this run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askParam, courses, courseId, sessionId]);

  function retry(question: string, failedId: string) {
    // Drop the failed answer and its question (they were never saved), then ask again.
    setMessages((all) => {
      const i = all.findIndex((m) => m.id === failedId);
      return i > 0 ? all.filter((_, j) => j !== i && j !== i - 1) : all;
    });
    void send(question);
  }

  // ---- citations -> sources panel / page viewer -------------------------------
  const selected = messages.find((m) => m.id === selectedId && m.role === "assistant") ?? null;
  const selectedSources = useMemo(() => selected?.sources ?? [], [selected]);
  const citedSet = useMemo(() => {
    if (!selected) return new Set<number>();
    if (selected.phase) {
      // still streaming: what has been cited so far (only numbers that exist)
      const exists = new Set(selected.sources.map((s) => s.n));
      return new Set(
        [...selected.content.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])).filter((n) => exists.has(n)),
      );
    }
    return new Set(selected.sources.filter((s) => s.cited).map((s) => s.n));
  }, [selected]);

  const cite = useCallback((messageId: string, n: number) => {
    setSelectedId(messageId);
    setActiveN(n);
    // Below xl there's no side panel: open the sources dialog instead.
    if (!window.matchMedia("(min-width: 80rem)").matches) setSourcesOpen(true);
  }, []);

  async function openSource(s: ChatSource) {
    if (!courseId) return;
    let materials = materialsCache.current.get(courseId);
    if (!materials) {
      try {
        materials = await listMaterials(courseId);
        materialsCache.current.set(courseId, materials);
      } catch {
        return;
      }
    }
    const material = materials.find((m) => m.id === s.material_id);
    if (material) {
      setSourcesOpen(false);
      setViewer({ material, page: s.page_number, chunkId: s.chunk_id });
    }
  }

  // ---- chats list --------------------------------------------------------------
  function newChat(nextCourse: string | null = courseId) {
    abortRef.current?.abort();
    justCreated.current = null;
    setMessages([]);
    setLoadedSession(null);
    setSelectedId(null);
    setActiveN(null);
    setHistoryOpen(false);
    go({ course: nextCourse });
  }

  function openChat(s: ChatSession) {
    setHistoryOpen(false);
    if (s.id === sessionId) return;
    justCreated.current = null;
    go({ course: s.course_id, session: s.id });
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteSession(toDelete.id);
      setSessions((all) => all.filter((s) => s.id !== toDelete.id));
      if (toDelete.id === sessionId) newChat();
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  // ---- render ------------------------------------------------------------------
  if (loadError) {
    return (
      <EmptyState mood="confused" title="Couldn't open the chat" body={loadError}>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </EmptyState>
    );
  }
  if (!courses) return <PageLoading />;
  if (courses.length === 0) {
    return (
      <EmptyState mood="wave" title="First, a course and some notes" body="The chat answers from the notes you upload. Create a course and upload a PDF, then come back to ask about it.">
        <Button asChild>
          <Link href="/courses">Go to your courses</Link>
        </Button>
      </EmptyState>
    );
  }

  const nothingToSearch = course !== null && course.chunk_count === 0;
  const notice =
    status?.status === "off"
      ? status.message
      : status?.status === "paused"
        ? `${status.message}${status.available_at ? ` Answers work again at ${new Date(status.available_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}`
        : courseDeleted
          ? "This chat's course was deleted, so there's nothing left to search. Start a new chat."
          : null;
  // The main model is resting (Google said it's overloaded): say who answers instead.
  const fallbackNote =
    !notice && status?.status === "ok" && status.model && status.model !== status.main_model
      ? `${modelLabel(status.main_model)} is busy right now, so answers come from ${modelLabel(status.model)}.`
      : null;
  const currentChat = sessions.find((s) => s.id === sessionId) ?? (loadedSession?.id === sessionId ? loadedSession : null);
  const chatTitle = currentChat?.title ?? messages.find((m) => m.role === "user")?.content ?? "New chat";
  const questionCount = messages.filter((m) => m.role === "user").length;

  const chatList = (
    <ChatList
      sessions={sessions}
      activeId={sessionId}
      onOpen={openChat}
      onDelete={setToDelete}
      onNew={() => newChat()}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
      {/* ---------- left: course + chats ---------- */}
      <aside className="grid min-w-0 grid-cols-1 content-start gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
        <div>
          <h1 className="heading-6">Ask your notes</h1>
          <label htmlFor="course-pick" className="mt-4 block title-5 text-muted-foreground">
            Course
          </label>
          <select
            id="course-pick"
            value={courseId ?? ""}
            onChange={(e) => newChat(e.target.value)}
            disabled={streaming}
            className="mt-1 h-10 w-full rounded-lg border bg-card px-2 body-5 outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          >
            {courseDeleted && <option value="">(deleted course)</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} · ${c.name}` : c.name}
              </option>
            ))}
          </select>
          {course && (
            <p className="mt-2 caption-5 text-muted-foreground">
              {course.ready_material_count} {course.ready_material_count === 1 ? "file" : "files"} · {course.chunk_count} passages
            </p>
          )}
        </div>
        <div className="flex gap-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => newChat()} disabled={streaming}>
            <MessageSquarePlus aria-hidden="true" /> New chat
          </Button>
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History aria-hidden="true" /> Chats ({sessions.length})
          </Button>
        </div>
        <div className="hidden lg:block">{chatList}</div>
      </aside>

      {/* ---------- middle: conversation ---------- */}
      <section className="flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col" aria-label="Chat">
        <div className="min-w-0 flex-1">
          {loadingSession && messages.length === 0 ? (
            <PageLoading />
          ) : messages.length === 0 ? (
            <Welcome
              course={course}
              nothingToSearch={nothingToSearch}
              suggestions={suggestions?.courseId === courseId ? suggestions.items : null}
              onPick={(text) => setPreset({ text, nonce: Date.now() })}
            />
          ) : (
            <>
              {/* This chat: its title, and a visible way to delete it */}
              <div className="mb-6 flex items-center gap-3 border-b pb-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate title-3" title={chatTitle}>
                    {chatTitle}
                  </p>
                  <p className="caption-5 text-muted-foreground">
                    {course?.name ?? "Deleted course"} · {questionCount} {questionCount === 1 ? "question" : "questions"}
                  </p>
                </div>
                {currentChat && !streaming && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setToDelete(currentChat)}>
                    <Trash2 aria-hidden="true" /> Delete chat
                  </Button>
                )}
              </div>
              <ChatThread
                messages={messages}
                selectedId={selectedId}
                activeN={activeN}
                onCite={cite}
                onSelect={(id) => {
                  setSelectedId(id);
                  setActiveN(null);
                }}
                onRetry={retry}
                onShowSources={() => setSourcesOpen(true)}
              />
            </>
          )}
          {/* scroll-mb: stop ABOVE the sticky question box, not under it */}
          <div ref={bottomRef} className="h-4 scroll-mb-36" />
        </div>

        <div className="sticky bottom-0 z-10 -mx-2 mt-4 bg-background px-2 pb-4 pt-2">
          <Composer
            onSend={(q) => void send(q)}
            onStop={() => abortRef.current?.abort()}
            streaming={streaming}
            disabled={!course || courseDeleted || status?.status === "off" || nothingToSearch}
            notice={notice ?? fallbackNote}
            noticeTone={notice ? "error" : "info"}
            preset={preset}
            placeholder={course ? `Ask about ${course.name}…` : "Pick a course first"}
          />
        </div>
      </section>

      {/* ---------- right: sources (wide screens) ---------- */}
      <aside className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto" aria-label="Sources">
        <h2 className="mb-3 flex items-center gap-2 title-4">
          <Library className="size-4 text-muted-foreground" aria-hidden="true" />
          Sources
          {selectedSources.length > 0 && (
            <span className="caption-2 text-muted-foreground">
              · {citedSet.size} cited of {selectedSources.length}
            </span>
          )}
        </h2>
        <AnimatePresence mode="wait">
          <motion.div key={selectedId ?? "none"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {selected ? (
              <SourcesPanel
                sources={selectedSources}
                cited={citedSet}
                activeN={activeN}
                onSelect={setActiveN}
                onOpen={openSource}
              />
            ) : (
              <p className="rounded-xl border border-dashed p-4 body-6 text-muted-foreground">
                The passages behind each answer show up here. Click a number like{" "}
                <span className="mx-0.5 inline-grid h-4 min-w-4 place-items-center rounded border bg-card px-1 caption-4 text-foreground">
                  1
                </span>{" "}
                in an answer to see where it came from.
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </aside>

      {/* ---------- dialogs ---------- */}
      <Dialog open={sourcesOpen && selected !== null} onClose={() => setSourcesOpen(false)} title="Sources" description="The passages this answer was written from." className={SCROLLING_DIALOG}>
        <SourcesPanel sources={selectedSources} cited={citedSet} activeN={activeN} onSelect={setActiveN} onOpen={openSource} />
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="Your chats" description={course?.name} className={SCROLLING_DIALOG}>
        {chatList}
      </Dialog>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)} busy={deleting} title="Delete this chat?" description={toDelete?.title ?? "Untitled chat"} className="max-w-md">
        <p className="body-6 text-muted-foreground">The questions and answers are deleted. Your notes are not touched.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting} data-autofocus>
            Keep it
          </Button>
          <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" aria-hidden="true" />} Delete
          </Button>
        </div>
      </Dialog>

      <PagesDialog
        material={viewer?.material ?? null}
        initialPage={viewer?.page ?? 1}
        focusChunkId={viewer?.chunkId ?? null}
        focusKind="cited"
        onClose={() => setViewer(null)}
        onChanged={() => {}}
      />
    </div>
  );
}

/* "1 question", "3 questions". A chat holds question + answer pairs; a
   question whose answer was stopped before any text has no answer row. */
function questionCount(messages: number) {
  const n = Math.ceil(messages / 2);
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

/* Chats under Today / Yesterday / Last 7 days / Earlier (by last activity,
   your own clock). The list is already newest first, so groups stay in order. */
function groupByDay(sessions: ChatSession[]): [string, ChatSession[]][] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const labelFor = (iso: string) => {
    const t = new Date(iso).getTime();
    if (t >= startOfToday.getTime()) return "Today";
    if (t >= startOfToday.getTime() - day) return "Yesterday";
    if (t >= startOfToday.getTime() - 6 * day) return "Last 7 days";
    return "Earlier";
  };
  const groups: [string, ChatSession[]][] = [];
  for (const s of sessions) {
    const label = labelFor(s.updated_at);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(s);
    else groups.push([label, [s]]);
  }
  return groups;
}

function ChatList({
  sessions,
  activeId,
  onOpen,
  onDelete,
  onNew,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onOpen: (s: ChatSession) => void;
  onDelete: (s: ChatSession) => void;
  onNew: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Button variant="outline" size="sm" className="hidden w-full justify-start lg:inline-flex" onClick={onNew}>
        <MessageSquarePlus aria-hidden="true" /> New chat
      </Button>
      {sessions.length === 0 ? (
        <p className="px-1 py-2 body-6 text-muted-foreground">No chats in this course yet.</p>
      ) : (
        <div className="grid gap-4">
          {groupByDay(sessions).map(([label, group]) => (
            <section key={label} aria-label={label}>
              <h3 className="px-3 pb-1 caption-4 text-muted-foreground">{label}</h3>
              <ul className="grid gap-0.5">
                {group.map((s) => (
                  <li key={s.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onOpen(s)}
                      aria-current={s.id === activeId ? "page" : undefined}
                      className={cn(
                        "w-full rounded-lg py-2 pl-3 pr-10 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        s.id === activeId ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="block truncate title-4">{s.title ?? "New chat"}</span>
                      <span className="block caption-5 text-muted-foreground">
                        {timeAgo(s.updated_at)} · {questionCount(s.message_count)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s)}
                      aria-label={`Delete chat: ${s.title ?? "New chat"}`}
                      className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-60 outline-none transition-[opacity,color,background-color] hover:bg-background hover:text-destructive hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Welcome({
  course,
  nothingToSearch,
  suggestions,
  onPick,
}: {
  course: Course | null;
  nothingToSearch: boolean;
  /** null = still loading */
  suggestions: string[] | null;
  onPick: (text: string) => void;
}) {
  if (course && nothingToSearch) {
    return (
      <EmptyState mood="confused" title={`Nothing to read in ${course.name} yet`} body="Upload a PDF to this course and wait until it says Ready. Then ask anything about it here.">
        <Button asChild>
          <Link href={`/courses/${course.id}`}>Upload notes</Link>
        </Button>
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
      <Mascot mood="wave" className="w-12" />
      <h2 className="mt-4 heading-6">Ask anything about {course?.name ?? "your notes"}</h2>
      <p className="mt-2 body-6 text-muted-foreground">
        StudyMate answers only from your own notes and cites the page for every claim. If the answer isn&apos;t in
        your notes, it says so.
      </p>
      {/* Specific questions about topics in YOUR notes: what RAG answers well */}
      {/* Suggestions as a short list of rows: easy to scan, and each one is a full-width target */}
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2" aria-busy={suggestions === null}>
        {suggestions === null && [0, 1, 2, 3].map((i) => <span key={i} className="skeleton h-12 rounded-lg" />)}
        {suggestions?.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 + i * 0.06, ease: EASE }}
            className="group flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-3 text-left body-5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s}
            <ArrowUpRight
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  mood,
  title,
  body,
  children,
}: {
  mood: "wave" | "confused";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
      <Mascot mood={mood} className="w-12" />
      <h2 className="mt-4 heading-6">{title}</h2>
      <p className="mt-2 body-6 text-muted-foreground">{body}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
