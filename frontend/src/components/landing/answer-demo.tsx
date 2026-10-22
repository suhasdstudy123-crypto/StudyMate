"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { FileText } from "lucide-react";

/*
  A looping, scripted demo of StudyMate's core moment:
    type the question -> "thinking" -> answer -> source page -> highlight.
  It's fake data on purpose: it shows what the product does before you
  sign up. Real answers come from the backend in Stage 7.
*/

type Example = {
  question: string;
  answer: string;
  file: string;
  page: number;
  before: string;
  highlighted: string;
  after: string;
};

const EXAMPLES: Example[] = [
  {
    question: "What is a dirty read?",
    answer:
      "A dirty read is when a transaction reads data another transaction hasn't committed yet. If that one rolls back, the value you read never officially existed.",
    file: "DBMS Unit 4 Transactions.pdf",
    page: 12,
    before: "Suppose T2 reads the value of X written by T1 before T1 commits. If T1 then aborts, ",
    highlighted: "T2 has read a value that never existed in the database",
    after: ". This problem is known as a dirty read.",
  },
  {
    question: "Why does thrashing happen?",
    answer:
      "Thrashing happens when processes don't have enough frames for their working set, so the system spends more time swapping pages than running them.",
    file: "OS Unit 3 Memory Management.pdf",
    page: 27,
    before: "When the total demand for frames exceeds the available memory, ",
    highlighted: "processes spend more time paging than executing",
    after: ". This high paging activity is called thrashing.",
  },
  {
    question: "What does ARP do?",
    answer:
      "ARP finds the MAC address that belongs to an IP address on your local network, so a frame can actually be delivered to that machine.",
    file: "CN Unit 2 Network Layer.pdf",
    page: 8,
    before: "The Address Resolution Protocol ",
    highlighted: "maps a known IP address to the hardware (MAC) address",
    after: " of a host on the same LAN.",
  },
];

// The order of the scripted steps
type Phase = "typing" | "thinking" | "answer" | "source" | "highlight";

export function AnswerDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const reduceMotion = useReducedMotion();

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const example = EXAMPLES[index];

  // One effect drives the whole script. Every step schedules the next with
  // a timer; the cleanup cancels it if the component unmounts or the demo
  // scrolls out of view (no wasted work off-screen).
  useEffect(() => {
    if (reduceMotion || !inView) return;
    let t: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (typed < example.question.length) {
        t = setTimeout(() => setTyped((n) => n + 1), 45 + Math.random() * 45);
      } else {
        t = setTimeout(() => setPhase("thinking"), 350);
      }
    } else if (phase === "thinking") {
      t = setTimeout(() => setPhase("answer"), 1000);
    } else if (phase === "answer") {
      t = setTimeout(() => setPhase("source"), 900);
    } else if (phase === "source") {
      t = setTimeout(() => setPhase("highlight"), 600);
    } else {
      t = setTimeout(() => {
        setIndex((i) => (i + 1) % EXAMPLES.length);
        setTyped(0);
        setPhase("typing");
      }, 5200);
    }
    return () => clearTimeout(t);
  }, [phase, typed, example.question.length, inView, reduceMotion]);

  // With reduced motion: show the first example, fully revealed, no script.
  const show = reduceMotion ? "highlight" : phase;
  const question = reduceMotion ? example.question : example.question.slice(0, typed);
  const reached = (p: Phase) => {
    const order: Phase[] = ["typing", "thinking", "answer", "source", "highlight"];
    return order.indexOf(show) >= order.indexOf(p);
  };

  return (
    <div
      ref={ref}
      className="relative min-h-[27rem] rounded-lg border bg-card p-5 shadow-[0_1px_0_var(--rule),0_30px_60px_-30px_rgb(23_31_77/0.45)] sm:min-h-[26rem] sm:p-7"
    >
      {/* The question bubble, typed character by character */}
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground">
          {question}
          {show === "typing" && <span className="caret ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-current" />}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {show === "thinking" && (
          <motion.div
            key="thinking"
            className="mt-6 flex gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="Searching your notes"
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-2 rounded-full bg-muted-foreground"
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }}
              />
            ))}
          </motion.div>
        )}

        {reached("answer") && (
          <motion.div
            key={`answer-${index}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <p className="mt-6 leading-relaxed">
              {example.answer}
              <sup className="ml-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-bold text-primary">1</sup>
            </p>

            {reached("source") && (
              <motion.div
                className="mt-6 overflow-hidden rounded-md border bg-background"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
              >
                <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
                    <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">{example.file}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">Page {example.page}</span>
                </div>
                <blockquote className="border-l-2 border-destructive/60 px-4 py-4 font-serif text-[1.05rem] leading-[1.75] text-foreground/85">
                  {example.before}
                  <motion.mark
                    className="highlight transition-colors duration-500"
                    // Before the stroke arrives, keep the normal text colour
                    // (dark text on a dark background would be invisible).
                    style={{ color: reached("highlight") ? undefined : "inherit" }}
                    initial={{ backgroundSize: "0% 78%" }}
                    animate={{ backgroundSize: reached("highlight") ? "100% 78%" : "0% 78%" }}
                    transition={{ duration: 0.9, ease: [0.6, 0, 0.2, 1] }}
                  >
                    {example.highlighted}
                  </motion.mark>
                  {example.after}
                </blockquote>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
