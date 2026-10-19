"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";

import { useAuth } from "@/components/auth/auth-provider";
import { Mascot } from "@/components/mascot";
import { cn } from "@/lib/utils";

/*
  The first page after logging in. For now it greets you and shows what's
  next; Stage 4+ fills it with your real courses and recent questions.
  It's a Client Component because the greeting uses YOUR clock and the
  user comes from useAuth().
*/

const STEPS = [
  { title: "Create your account", body: "You're in. Your notes stay private to you.", done: true },
  { title: "Make your first course", body: "Group your notes by subject, like DBMS or Operating Systems.", done: false },
  { title: "Upload a PDF", body: "Lecture notes, slides or a previous-year paper.", done: false },
  { title: "Ask your first question", body: "Get an answer with the exact page it came from.", done: false },
];

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
  const doneCount = STEPS.filter((s) => s.done).length;

  return (
    <div className="grid gap-10">
      <section className="flex flex-col-reverse items-start justify-between gap-6 sm:flex-row sm:items-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
            {greeting()}, {firstName}.
          </h1>
          <p className="mt-3 max-w-lg text-lg text-muted-foreground">
            This is where your courses and questions will live. Here&apos;s what&apos;s next.
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
              {!step.done && i === doneCount && (
                <span className="shrink-0 rounded-full bg-highlight px-2.5 py-1 text-xs font-bold text-highlight-foreground">
                  Up next
                </span>
              )}
            </motion.li>
          ))}
        </ol>
      </motion.section>
    </div>
  );
}
