"use client";

import { motion, type Variants } from "motion/react";
import { Check, FileText, SendHorizontal } from "lucide-react";

/*
  Three steps. Each card rises in the first time it scrolls into view
  (whileInView + viewport once), then its small picture plays once.
*/

const EASE = [0.22, 1, 0.36, 1] as const;

const card: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: i * 0.1, ease: EASE },
  }),
};

const STEPS = [
  {
    title: "Upload your PDFs",
    body: "Lecture notes, slides and previous-year papers, organised by course.",
    Art: UploadArt,
  },
  {
    title: "Ask in your own words",
    body: "Type the question the way you'd ask a friend the night before the exam.",
    Art: AskArt,
  },
  {
    title: "Check the page",
    body: "Every answer links to the page it used, with the passage highlighted.",
    Art: CheckArt,
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 lg:py-24" aria-labelledby="how-heading">
      <motion.h2
        id="how-heading"
        className="heading-5 sm:heading-4"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        How it works
      </motion.h2>

      <div className="mt-8">
        <ol className="grid gap-8 sm:grid-cols-3">
          {STEPS.map(({ title, body, Art }, i) => (
            <motion.li
              key={title}
              custom={i}
              variants={card}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.4 }}
            >
              <div className="h-40 overflow-hidden rounded-xl border bg-card">
                <Art />
              </div>
              <h3 className="mt-4 title-2">
                <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                {title}
              </h3>
              <p className="mt-1 body-3 text-muted-foreground">{body}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- the three little animations ---------- */

/*
  These use "variants": named states (hidden / show). They have no scroll
  trigger of their own; they inherit the state of their step card above,
  so each one plays when its card scrolls into view.
*/

function UploadArt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="relative grid h-20 w-full place-items-center rounded-lg border border-dashed">
        <motion.div
          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 title-4"
          variants={{
            hidden: { y: -24, opacity: 0 },
            show: { y: 0, opacity: 1, transition: { duration: 0.6, delay: 0.5, ease: EASE } },
          }}
        >
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          Unit 4 Notes.pdf
        </motion.div>
      </div>
      <div className="flex w-full items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full origin-left rounded-full bg-primary"
            variants={{
              hidden: { scaleX: 0 },
              show: { scaleX: 1, transition: { duration: 1.2, delay: 1.1, ease: EASE } },
            }}
          />
        </div>
        <motion.span
          className="inline-flex items-center gap-1 caption-3 text-success"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { delay: 2.2, duration: 0.3, ease: EASE } },
          }}
        >
          <Check className="size-3.5" aria-hidden="true" /> Ready
        </motion.span>
      </div>
    </div>
  );
}

function AskArt() {
  const text = "explain two-phase locking";
  return (
    <div className="flex h-full items-center px-4">
      <div className="flex w-full items-center gap-2 rounded-lg border bg-background py-1 pl-3 pr-1">
        <span className="flex-1 overflow-hidden whitespace-nowrap body-6">
          {text.split("").map((ch, i) => (
            <motion.span
              key={i}
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { delay: 0.6 + i * 0.045, duration: 0.01 } },
              }}
            >
              {ch}
            </motion.span>
          ))}
        </span>
        <motion.span
          className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"
          variants={{
            hidden: { opacity: 0.4 },
            show: { opacity: 1, transition: { delay: 0.6 + text.length * 0.045, duration: 0.3, ease: EASE } },
          }}
        >
          <SendHorizontal className="size-4" aria-hidden="true" />
        </motion.span>
      </div>
    </div>
  );
}

function CheckArt() {
  const widths = ["92%", "80%", "88%", "70%", "84%"];
  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="relative h-32 w-28 rounded-lg border bg-background p-3">
        <div className="flex flex-col gap-3">
          {widths.map((w, i) => (
            <div key={i} className="relative h-1.5 rounded-full bg-muted-foreground/25" style={{ width: w }}>
              {i === 2 && (
                <motion.div
                  className="absolute -inset-x-1 -inset-y-1 origin-left rounded-sm bg-highlight"
                  variants={{
                    hidden: { scaleX: 0 },
                    show: { scaleX: 1, transition: { delay: 0.7, duration: 0.8, ease: EASE } },
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <motion.span
          className="absolute -right-8 -top-3 rounded-md border bg-card px-2 py-1 caption-3"
          variants={{
            hidden: { opacity: 0, y: 4 },
            show: { opacity: 1, y: 0, transition: { delay: 1.5, duration: 0.5, ease: EASE } },
          }}
        >
          Page 12
        </motion.span>
      </div>
    </div>
  );
}
