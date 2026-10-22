"use client";

import { useEffect, useState } from "react";
import { Plus, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { CourseCard } from "@/components/courses/course-card";
import { CourseFormDialog } from "@/components/courses/course-form-dialog";
import { DeleteCourseDialog } from "@/components/courses/delete-course-dialog";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listCourses, type Course } from "@/lib/courses";

/*
  /courses: the student's own courses, on real data.

  Data flow:
    page opens        -> GET /api/courses   -> course cards
    "New course"      -> POST               -> new card added at the top
    pencil on a card  -> PATCH              -> that card replaced
    bin on a card     -> DELETE             -> that card removed

  The list lives in React state here. After each change we update the list
  with what the backend SENT BACK (the saved course), instead of reloading
  everything or guessing: the server's answer is the truth.
*/

const SUGGESTIONS = ["DBMS", "Operating Systems", "Computer Networks", "Machine Learning"];

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready" };

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // Which dialog is open. "create" | a course to edit | nothing.
  const [form, setForm] = useState<{ course?: Course; suggestedName?: string } | null>(null);
  const [toDelete, setToDelete] = useState<Course | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Bumping this number re-runs the loading effect below ("Try again").
  const [attempt, setAttempt] = useState(0);

  // Runs after the page first appears in the browser, and again on retry.
  // State is only set when the answer ARRIVES; `alive` ignores a late answer
  // if we've already left the page.
  useEffect(() => {
    let alive = true;
    listCourses()
      .then((list) => {
        if (!alive) return;
        setCourses(list);
        setLoad({ state: "ready" });
      })
      .catch((err) => {
        if (!alive) return;
        setLoad({ state: "error", message: err instanceof ApiError ? err.message : "Couldn't load your courses." });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  function retry() {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  function onSaved(saved: Course) {
    const isEdit = Boolean(form?.course);
    setCourses((list) => (isEdit ? list.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...list]));
    if (!isEdit) setNewId(saved.id);
    setAnnouncement(isEdit ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
    setForm(null);
  }

  function onDeleted(id: string) {
    const gone = courses.find((c) => c.id === id);
    setCourses((list) => list.filter((c) => c.id !== id));
    setAnnouncement(gone ? `Deleted ${gone.name}.` : "Deleted.");
    setToDelete(null);
  }

  // Remove the "just created" ring after a moment.
  useEffect(() => {
    if (!newId) return;
    const t = setTimeout(() => setNewId(null), 2400);
    return () => clearTimeout(t);
  }, [newId]);

  const total = courses.length;
  const files = courses.reduce((n, c) => n + c.material_count, 0);

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Your courses</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {load.state === "ready" && total > 0
              ? `${total} ${total === 1 ? "course" : "courses"} · ${files} ${files === 1 ? "file" : "files"}`
              : "One notebook per subject. Answers only come from the notes inside."}
          </p>
        </motion.div>
        {load.state === "ready" && total > 0 && (
          <Button size="lg" onClick={() => setForm({})}>
            <Plus aria-hidden="true" />
            New course
          </Button>
        )}
      </header>

      {/* Screen readers hear "Created DBMS." etc. without the focus moving. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {load.state === "loading" && <Skeletons />}

      {load.state === "error" && (
        <div className="flex flex-col items-center rounded-lg border bg-card px-6 py-12 text-center" role="alert">
          <Mascot mood="confused" className="w-24" />
          <h2 className="mt-5 text-xl font-bold">Couldn&apos;t open your courses</h2>
          <p className="mt-1 max-w-sm text-muted-foreground">{load.message}</p>
          <Button variant="outline" className="mt-5" onClick={retry}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}

      {load.state === "ready" && total === 0 && <EmptyState onPick={(name) => setForm({ suggestedName: name })} />}

      {load.state === "ready" && total > 0 && (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Courses">
          <AnimatePresence mode="popLayout" initial={false}>
            {courses.map((course, i) => (
              <CourseCard
                key={course.id}
                course={course}
                index={i}
                isNew={course.id === newId}
                onEdit={(c) => setForm({ course: c })}
                onDelete={setToDelete}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      <CourseFormDialog
        open={form !== null}
        course={form?.course}
        suggestedName={form?.suggestedName}
        onClose={() => setForm(null)}
        onSaved={onSaved}
      />
      <DeleteCourseDialog course={toDelete} onClose={() => setToDelete(null)} onDeleted={onDeleted} />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (name?: string) => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="ruled relative overflow-hidden rounded-lg border bg-card px-6 py-12 text-center sm:py-16"
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-10 w-px bg-destructive/30 sm:left-16" />
      <Mascot mood="wave" className="mx-auto w-28" />
      <h2 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">Start your first notebook</h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">
        Make a course for each subject. Then upload its notes and ask questions about them.
      </p>
      <Button size="lg" className="mt-6" onClick={() => onPick()}>
        <Plus aria-hidden="true" />
        New course
      </Button>
      <div className="mt-6">
        <p className="text-sm font-semibold text-muted-foreground">Or start with one of these</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onPick(name)}
              className="rounded-full border bg-background px-3.5 py-1.5 text-sm font-semibold transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              + {name}
            </button>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function Skeletons() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading courses" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex h-52 overflow-hidden rounded-lg border bg-card">
          <div className="w-7 bg-muted" />
          <div className="flex flex-1 animate-pulse flex-col gap-3 p-5">
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-6 w-3/4 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="mt-auto h-4 w-1/3 rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
