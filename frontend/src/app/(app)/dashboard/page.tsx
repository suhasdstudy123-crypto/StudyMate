"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText } from "lucide-react";
import { motion } from "motion/react";

import { useAuth } from "@/components/auth/auth-provider";
import { Mascot } from "@/components/mascot";
import { listCourses, timeAgo, type Course } from "@/lib/courses";
import { cn } from "@/lib/utils";

/*
  The first page after logging in. It greets you, ticks off the
  getting-started steps from REAL data (GET /api/courses), and shows your
  most recent courses. Later stages add uploads and recent questions.
  It's a Client Component because the greeting uses YOUR clock and the
  user comes from useAuth().
*/

function buildSteps(courses: Course[]) {
  const hasCourse = courses.length > 0;
  const hasFile = courses.some((c) => c.material_count > 0);
  return [
    { title: "Create your account", body: "You're in. Your notes stay private to you.", done: true, href: null },
    {
      title: "Make your first course",
      body: "Group your notes by subject, like DBMS or Operating Systems.",
      done: hasCourse,
      href: "/courses",
    },
    { title: "Upload a PDF", body: "Lecture notes, slides or a previous-year paper.", done: hasFile, href: null },
    { title: "Ask your first question", body: "Get an answer with the exact page it came from.", done: false, href: null },
  ];
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  // null = still loading. If loading fails, the dashboard just shows the
  // checklist without course data; the Courses page has the full error UI.
  const [courses, setCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    let alive = true; // ignore the answer if we left the page meanwhile
    listCourses()
      .then((list) => alive && setCourses(list))
      .catch(() => alive && setCourses([]));
    return () => {
      alive = false;
    };
  }, []);

  const STEPS = buildSteps(courses ?? []);
  const doneCount = STEPS.filter((s) => s.done).length;

  return (
    <div className="grid gap-10">
      <section className="flex flex-col-reverse items-start justify-between gap-6 sm:flex-row sm:items-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
            {greeting()}, {firstName}.
          </h1>
          <p className="mt-3 max-w-lg text-lg text-muted-foreground">
            {courses && courses.length > 0
              ? "Pick up where you left off, or keep setting things up."
              : "This is where your courses and questions will live. Here's what's next."}
          </p>
        </motion.div>
        <Mascot mood="wave" className="w-24 shrink-0 sm:w-28" />
      </section>

      <motion.section
        className="rounded-lg border bg-card p-6 sm:p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        aria-labelledby="getting-started"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="getting-started" className="text-xl font-bold">
            Getting started
          </h2>
          <p className="text-sm font-semibold text-muted-foreground">
            {doneCount} of {STEPS.length} done
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full origin-left rounded-full bg-primary"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: doneCount / STEPS.length }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          />
        </div>

        <ol className="mt-6 grid gap-3">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.title}
              className={cn("flex items-start gap-4 rounded-md border p-4", step.done ? "bg-muted/60" : "bg-background")}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.25 + i * 0.08 }}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-black",
                  step.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                )}
              >
                {step.done ? <Check className="size-4" aria-label="Done" /> : i + 1}
              </span>
              <div className="flex-1">
                <h3 className={cn("font-bold", step.done && "text-muted-foreground line-through decoration-2")}>
                  {step.title}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
              </div>
              {!step.done && i === doneCount && courses !== null && (
                step.href ? (
                  <Link
                    href={step.href}
                    className="shrink-0 rounded-full bg-highlight px-2.5 py-1 text-xs font-bold text-highlight-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Up next →
                  </Link>
                ) : (
                  <span className="shrink-0 rounded-full bg-highlight px-2.5 py-1 text-xs font-bold text-highlight-foreground">
                    Up next
                  </span>
                )
              )}
            </motion.li>
          ))}
        </ol>
      </motion.section>

      {courses && courses.length > 0 && <RecentCourses courses={courses.slice(0, 3)} total={courses.length} />}
    </div>
  );
}

function RecentCourses({ courses, total }: { courses: Course[]; total: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      aria-labelledby="recent-courses"
    >
      <div className="flex items-end justify-between gap-4">
        <h2 id="recent-courses" className="text-xl font-bold">
          Recent courses
        </h2>
        <Link
          href="/courses"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {total > courses.length ? `All ${total} courses` : "Manage courses"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {courses.map((c) => (
          <li key={c.id}>
            <Link
              href="/courses"
              className="flex h-full overflow-hidden rounded-md border bg-card outline-none transition-[transform,border-color] hover:-translate-y-0.5 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className="binding w-4 shrink-0 bg-primary" />
              <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                <span className="truncate font-bold">{c.name}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <FileText className="size-3.5" aria-hidden="true" />
                  {c.material_count === 0 ? "No files yet" : `${c.material_count} ${c.material_count === 1 ? "file" : "files"}`}
                  <span aria-hidden="true">·</span>
                  {timeAgo(c.last_activity)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
