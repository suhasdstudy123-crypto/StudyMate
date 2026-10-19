"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";

import { AnswerDemo } from "@/components/landing/answer-demo";
import { Mascot, type MascotMood } from "@/components/mascot";
import { Button } from "@/components/ui/button";

const HEADLINE = "Answers from your own notes, down to the page.";

// What Marky says when you click him
const LINES = [
  "Hi! I only read your notes. No made-up answers.",
  "Try asking me: explain two-phase locking.",
  "I show you the exact page. Like a topper's notes.",
  "Upload PYQs and I'll find the answers in them.",
  "Exam tomorrow? Let's go.",
];

export function Hero() {
  const [lineIndex, setLineIndex] = useState(0);
  const [ctaHover, setCtaHover] = useState(false);
  const [poked, setPoked] = useState(false);

  // After being clicked, Marky stays happy for a moment, then calms down.
  useEffect(() => {
    if (!poked) return;
    const t = setTimeout(() => setPoked(false), 1400);
    return () => clearTimeout(t);
  }, [poked]);

  const mood: MascotMood = poked ? "wave" : ctaHover ? "happy" : "idle";

  function pokeMarky() {
    setLineIndex((i) => (i + 1) % LINES.length);
    setPoked(true);
  }

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="grid-paper pointer-events-none absolute inset-0 -z-10" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-28 lg:pt-14">
        <div className="max-w-xl">
          {/* Headline: words rise in one after another, once, on page load */}
          <h1 className="text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.25rem]">
            {HEADLINE.split(" ").map((word, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: "0.4em" }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.08 + i * 0.06, ease: [0.2, 0.7, 0.2, 1] }}
              >
                {word}&nbsp;
              </motion.span>
            ))}
          </h1>

          <motion.p
            className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
          >
            Upload your lecture notes and previous-year papers. StudyMate answers your questions using
            only what&apos;s in them, and shows you exactly where each answer came from.
          </motion.p>

          <motion.div
            className="mt-9 flex flex-wrap gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <Button
              asChild
              size="lg"
              className="transition-transform hover:-translate-y-0.5 active:translate-y-0"
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              onFocus={() => setCtaHover(true)}
              onBlur={() => setCtaHover(false)}
            >
              <Link href="/register">Create free account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Log in</Link>
            </Button>
          </motion.div>
        </div>

        <div className="relative">
          {/* Marky and his speech bubble, sitting on top of the demo card */}
          <motion.div
            className="relative z-10 -mb-8 flex items-end justify-end gap-2 pr-2 sm:pr-6"
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 180, damping: 16, delay: 0.4 }}
          >
            <div className="mb-20 max-w-[15rem]" aria-live="polite">
              <AnimatePresence mode="wait">
                <motion.p
                  key={lineIndex}
                  className="relative rounded-lg rounded-br-sm border bg-card px-3.5 py-2.5 text-sm font-medium shadow-sm"
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.22 }}
                >
                  {LINES[lineIndex]}
                </motion.p>
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={pokeMarky}
              className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Talk to Marky"
            >
              <Mascot mood={mood} className="w-32 sm:w-40" />
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: "easeOut" }}
          >
            <AnswerDemo />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
