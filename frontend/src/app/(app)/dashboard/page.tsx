"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { animate, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  Layers,
  Loader2,
  MessageCircleQuestion,
  MessagesSquare,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteSession, getSuggestions, listSessions, MAX_QUESTION_CHARS, type ChatSession } from "@/lib/chat";
import { listCourses, timeAgo, type Course } from "@/lib/courses";
import { cn } from "@/lib/utils";

/*
  The first page after logging in (redesigned in Stage 7).

    greeting    "Good afternoon, Suhas" + a quick "ask your notes" box
                (sends you to /chat with the question, which asks it at once)
    numbers     courses, files, passages, questions: counted from real data
    left        your recent chats (open / delete)
    right       your courses
    checklist   getting started: only while something is left to do

  Everything comes from two requests: GET /courses and GET /chat/sessions.
  It's a Client Component: the greeting uses YOUR clock, the user comes from
  useAuth(), and the numbers animate.
*/

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const questionsIn = (s: ChatSession) => Math.ceil(s.message_count / 2);

// One curve for every movement on the site (same as --ease-soft in globals.css)
const EASE = [0.22, 1, 0.36, 1] as const;

export default function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  // null = still loading. If loading fails, the dashboard shows what it can;
  // the Courses and Ask pages have the full error handling.
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [chats, setChats] = useState<ChatSession[] | null>(null);
  const [toDelete, setToDelete] = useState<ChatSession | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true; // ignore the answers if we left the page meanwhile
    listCourses()
      .then((list) => alive && setCourses(list))
      .catch(() => alive && setCourses([]));
    listSessions()
      .then((list) => alive && setChats(list))
      .catch(() => alive && setChats([]));
    return () => {
      alive = false;
    };
  }, []);

  const loaded = courses !== null && chats !== null;
  const withNotes = (courses ?? []).filter((c) => c.chunk_count > 0);
  const numbers = {
    courses: courses?.length ?? 0,
    files: (courses ?? []).reduce((n, c) => n + c.ready_material_count, 0),
    passages: (courses ?? []).reduce((n, c) => n + c.chunk_count, 0),
    questions: (chats ?? []).reduce((n, s) => n + questionsIn(s), 0),
  };

  const steps = [
    { title: "Create your account", done: true, href: null },
    { title: "Make a course", done: numbers.courses > 0, href: "/courses" },
    {
      title: "Upload a PDF",
      done: (courses ?? []).some((c) => c.material_count > 0),
      href: courses?.[0] ? `/courses/${courses[0].id}` : "/courses",
    },
    { title: "Ask a question", done: numbers.questions > 0, href: withNotes[0] ? `/chat?course=${withNotes[0].id}` : null },
  ];
  const allDone = steps.every((s) => s.done);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteSession(toDelete.id);
      setChats((all) => (all ?? []).filter((s) => s.id !== toDelete.id));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      {/* ---------- greeting + quick ask ---------- */}
      <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <div className="grid items-center gap-6">
          <div className="min-w-0">
            <h1 className="heading-5 sm:heading-4">
              {greeting()}, {firstName || "there"}
            </h1>
            <p className="mt-2 max-w-xl body-3 text-muted-foreground">
              {!loaded
                ? "Opening your notes…"
                : withNotes.length > 0
                  ? "What do you want to understand today? Ask, and every answer comes with the page it's from."
                  : numbers.courses > 0
                    ? "Upload a PDF to one of your courses, and you can start asking questions about it."
                    : "Make a course, upload your notes, and ask anything about them."}
            </p>
            <div className="mt-6">
              {!loaded ? (
                <div className="skeleton h-14 max-w-2xl rounded-xl" />
              ) : withNotes.length > 0 ? (
                <QuickAsk courses={withNotes} />
              ) : (
                <Button asChild size="lg">
                  <Link href={numbers.courses > 0 ? `/courses/${courses![0].id}` : "/courses"}>
                    {numbers.courses > 0 ? "Upload notes" : "Make your first course"}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.section>

      {/* ---------- numbers: one strip, divided, instead of four floating cards ---------- */}
      <section
        aria-label="Your numbers"
        className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card lg:grid-cols-4 [&>*]:border-border max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r"
      >
        <Stat icon={BookOpen} label="Courses" value={numbers.courses} loaded={loaded} delay={0.05} />
        <Stat icon={FileText} label="Files read" value={numbers.files} loaded={loaded} delay={0.1} />
        <Stat icon={Layers} label="Searchable passages" value={numbers.passages} loaded={loaded} delay={0.15} />
        <Stat icon={MessagesSquare} label="Questions asked" value={numbers.questions} loaded={loaded} delay={0.2} />
      </section>

      {/* ---------- getting started: only while something is left ---------- */}
      {loaded && !allDone && <GettingStarted steps={steps} />}

      {/* ---------- chats + courses ---------- */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RecentChats
          chats={chats}
          courses={courses ?? []}
          firstCourse={withNotes[0] ?? null}
          onDelete={setToDelete}
        />
        <YourCourses courses={courses} />
      </div>

      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        busy={deleting}
        title="Delete this chat?"
        description={toDelete?.title ?? "Untitled chat"}
        className="max-w-md"
      >
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
    </div>
  );
}

/* Ask straight from the dashboard: /chat?course=…&ask=… asks it at once. */
function QuickAsk({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0].id);
  const [text, setText] = useState("");
  const question = text.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!question) return;
        router.push(`/chat?course=${courseId}&ask=${encodeURIComponent(question.slice(0, MAX_QUESTION_CHARS))}`);
      }}
      className="flex max-w-2xl flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 sm:flex-row sm:items-center"
    >
      {courses.length > 1 && (
        <>
          <label htmlFor="quick-course" className="sr-only">
            Course
          </label>
          <select
            id="quick-course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="h-10 rounded-lg bg-muted px-2 body-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-48"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor="quick-ask" className="sr-only">
          Your question
        </label>
        <input
          id="quick-ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={`Ask about ${courses.find((c) => c.id === courseId)?.name ?? "your notes"}…`}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 body-3 outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!question}
          aria-label="Ask"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground outline-none transition-[transform,opacity] hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-40"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

/* A number that counts up from 0 when it appears (instantly with reduced motion). */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) {
      const t = setTimeout(() => setShown(value), 0);
      return () => clearTimeout(t);
    }
    const controls = animate(0, value, {
      duration: Math.min(1.2, 0.4 + value / 400),
      ease: EASE,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <>{shown.toLocaleString()}</>;
}

function Stat({
  icon: Icon,
  label,
  value,
  loaded,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  loaded: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className="p-4"
    >
      <p className="flex items-center gap-2 caption-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </p>
      <p className="mt-1 heading-5 tabular-nums">
        {loaded ? <CountUp value={value} /> : <span className="skeleton inline-block h-8 w-12 rounded-md align-middle" />}
      </p>
    </motion.div>
  );
}

type Step = { title: string; done: boolean; href: string | null };

function GettingStarted({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
      aria-labelledby="getting-started"
      className="rounded-xl border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="getting-started" className="title-3">
          Getting started
        </h2>
        <p className="caption-2 text-muted-foreground">
          {done} of {steps.length} done
        </p>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-4">
        {steps.map((s, i) => {
          const isNext = i === next;
          const body = (
            <>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border caption-3 tabular-nums",
                  s.done && "border-success bg-success text-card",
                  isNext && "border-primary text-primary",
                  !s.done && !isNext && "text-muted-foreground",
                )}
              >
                {s.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
              </span>
              <span className={cn("body-5", s.done && "text-muted-foreground line-through")}>{s.title}</span>
              {isNext && s.href && <ArrowRight className="ml-auto size-4 text-primary" aria-hidden="true" />}
            </>
          );
          const cls = cn(
            "flex h-full items-center gap-2 rounded-lg border p-3",
            isNext ? "border-primary/50 bg-card" : "bg-background",
          );
          return (
            <li key={s.title}>
              {isNext && s.href ? (
                <Link
                  href={s.href}
                  className={cn(cls, "outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}

function RecentChats({
  chats,
  courses,
  firstCourse,
  onDelete,
}: {
  chats: ChatSession[] | null;
  courses: Course[];
  firstCourse: Course | null;
  onDelete: (s: ChatSession) => void;
}) {
  const recent = (chats ?? []).slice(0, 5);
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
      aria-labelledby="recent-chats"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="recent-chats" className="heading-6">
          Recent chats
        </h2>
        {firstCourse && (
          <Link
            href={`/chat?course=${firstCourse.id}`}
            className="inline-flex items-center gap-1 rounded-md body-5 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            New chat <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      {chats === null ? (
        <div className="mt-4 grid gap-px overflow-hidden rounded-xl border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <NoChatsYet course={firstCourse} />
      ) : (
        <ul className="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {recent.map((s, i) => {
            const course = courses.find((c) => c.id === s.course_id);
            const n = questionsIn(s);
            return (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.05, ease: EASE }}
                className="group relative"
              >
                <Link
                  href={`/chat?course=${s.course_id ?? ""}&session=${s.id}`}
                  className="flex items-center gap-3 py-3 pl-4 pr-12 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <MessageCircleQuestion className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate title-4">{s.title ?? "Untitled chat"}</span>
                    <span className="block truncate caption-5 text-muted-foreground">
                      {course?.name ?? s.course_name ?? "Deleted course"} · {n} {n === 1 ? "question" : "questions"} ·{" "}
                      {timeAgo(s.updated_at)}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => onDelete(s)}
                  aria-label={`Delete chat: ${s.title ?? "Untitled chat"}`}
                  className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground opacity-60 outline-none transition-[opacity,color,background-color] hover:bg-background hover:text-destructive hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

/* No chats yet: offer real questions from the student's own notes. */
function NoChatsYet({ course }: { course: Course | null }) {
  const [ideas, setIdeas] = useState<string[] | null>(null);
  useEffect(() => {
    if (!course) return;
    let alive = true;
    getSuggestions(course.id)
      .then((s) => alive && setIdeas(s.slice(0, 3)))
      .catch(() => alive && setIdeas([]));
    return () => {
      alive = false;
    };
  }, [course]);

  return (
    <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed p-6 text-center">
      <Mascot mood="peek" className="w-12" />
      <p className="mt-3 title-3">No questions yet</p>
      <p className="mt-1 body-6 text-muted-foreground">
        {course ? `Try one about ${course.name}:` : "Upload notes to a course first, then ask about them."}
      </p>
      {course && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {(ideas ?? []).map((q) => (
            <Link
              key={q}
              href={`/chat?course=${course.id}&ask=${encodeURIComponent(q)}`}
              className="rounded-lg border bg-card px-3 py-2 body-5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {q}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function YourCourses({ courses }: { courses: Course[] | null }) {
  const shown = (courses ?? []).slice(0, 4);
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
      aria-labelledby="your-courses"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="your-courses" className="heading-6">
          Your courses
        </h2>
        <Link
          href="/courses"
          className="inline-flex items-center gap-1 rounded-md body-5 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {courses && courses.length > shown.length ? `All ${courses.length}` : "Manage"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {courses === null ? (
        <div className="mt-4 grid gap-px overflow-hidden rounded-xl border">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed p-6 text-center body-6 text-muted-foreground">
          No courses yet.{" "}
          <Link href="/courses" className="body-5 text-primary hover:underline">
            Make one
          </Link>
        </p>
      ) : (
        <ul className="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {shown.map((c) => (
            <li key={c.id}>
              <Link
                href={`/courses/${c.id}`}
                className="flex outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate title-4">{c.name}</span>
                    {c.code && <span className="shrink-0 caption-4 text-muted-foreground">{c.code}</span>}
                  </span>
                  <span className="flex items-center gap-1 caption-5 text-muted-foreground">
                    <FileText className="size-3.5" aria-hidden="true" />
                    {c.material_count === 0
                      ? "No files yet"
                      : `${c.material_count} ${c.material_count === 1 ? "file" : "files"} · ${c.chunk_count} passages`}
                    <span aria-hidden="true">·</span>
                    {timeAgo(c.last_activity)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
