"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type Variants } from "motion/react";
import { Check, FileText, SendHorizontal } from "lucide-react";

/*
  Three steps. Each card plays a small animation the first time it scrolls
  into view (whileInView + viewport once). The line along the top fills
  as you scroll through the section (useScroll -> scaleX).
*/

const card: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.15, ease: [0.2, 0.7, 0.2, 1] },
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
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section ref={ref} className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="how-heading">
      <motion.h2
        id="how-heading"
        className="text-3xl font-extrabold tracking-tight sm:text-4xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 0.5 }}
      >
        How it works
      </motion.h2>

      <div className="relative mt-12">
        {/* progress line behind the step numbers (wide screens only) */}
        <div aria-hidden="true" className="absolute left-0 right-0 top-[1.15rem] hidden h-[3px] rounded-full bg-border sm:block">
          <motion.div className="h-full origin-left rounded-full bg-primary" style={{ scaleX: lineScale }} />
        </div>

        <ol className="relative grid gap-12 sm:grid-cols-3 sm:gap-8">
          {STEPS.map(({ title, body, Art }, i) => (
            <motion.li
              key={title}
              custom={i}
              variants={card}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.4 }}
            >
              <span className="relative inline-grid size-10 place-items-center rounded-full border-2 border-foreground bg-background text-lg font-black tabular-nums text-primary">
                {i + 1}
              </span>
              <div className="mt-6 h-40 overflow-hidden rounded-lg border bg-card">
                <Art />
              </div>
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
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
      <div className="relative grid h-20 w-full place-items-center rounded-md border-2 border-dashed border-primary/40">
        <motion.div
          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold shadow-sm"
          variants={{
            hidden: { y: -70, rotate: -8, opacity: 0 },
            show: { y: 0, rotate: 0, opacity: 1, transition: { type: "spring", stiffness: 200, damping: 14, delay: 0.5 } },
          }}
        >
          <FileText className="size-4 text-primary" aria-hidden="true" />
          Unit 4 Notes.pdf
        </motion.div>
      </div>
      <div className="flex w-full items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full origin-left rounded-full bg-primary"
            variants={{
              hidden: { scaleX: 0 },
              show: { scaleX: 1, transition: { duration: 1.2, delay: 1.1, ease: "easeInOut" } },
            }}
          />
        </div>
        <motion.span
          className="inline-flex items-center gap-1 text-xs font-bold text-primary"
          variants={{
            hidden: { opacity: 0, scale: 0.6 },
            show: { opacity: 1, scale: 1, transition: { delay: 2.3, type: "spring", stiffness: 300, damping: 15 } },
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
    <div className="flex h-full items-center px-5">
      <div className="flex w-full items-center gap-2 rounded-full border bg-background py-1.5 pl-4 pr-1.5">
        <span className="flex-1 overflow-hidden whitespace-nowrap text-sm">
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
          className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"
          variants={{
            hidden: { scale: 0.6, opacity: 0.4 },
            show: { scale: [0.6, 1.2, 1], opacity: 1, transition: { delay: 0.6 + text.length * 0.045, duration: 0.45 } },
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
      <div className="relative h-32 w-28 rounded-md border bg-background p-3 shadow-sm">
        <div className="flex flex-col gap-2.5">
          {widths.map((w, i) => (
            <div key={i} className="relative h-1.5 rounded-full bg-muted-foreground/25" style={{ width: w }}>
              {i === 2 && (
                <motion.div
                  className="absolute -inset-x-1 -inset-y-1 origin-left rounded-sm bg-highlight"
                  variants={{
                    hidden: { scaleX: 0 },
                    show: { scaleX: 1, transition: { delay: 0.7, duration: 0.8, ease: [0.6, 0, 0.2, 1] } },
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <motion.span
          className="absolute -right-6 -top-3 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow"
          variants={{
            hidden: { opacity: 0, scale: 0.4, rotate: -12 },
            show: { opacity: 1, scale: 1, rotate: 6, transition: { delay: 1.5, type: "spring", stiffness: 320, damping: 14 } },
          }}
        >
          Page 12
        </motion.span>
      </div>
    </div>
  );
}
