"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { AnswerDemo } from "@/components/landing/answer-demo";
import { Button } from "@/components/ui/button";

// One curve for every movement on the site (same as --ease-soft in globals.css)
const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-8 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:pb-24 lg:pt-20">
      <motion.div
        className="max-w-[680px]"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        {/*
          The hero heading is the one place text gets a gradient (left to
          right, ink to grey); everything else is flat. The line break sits
          where the thought breaks, so the second line lands on its own.
        */}
        <h1 className="heading-4 bg-linear-to-r from-black to-[#666666] bg-clip-text pb-1 text-transparent sm:heading-2 lg:heading-1 dark:from-white dark:to-[#9b9b9b]">
          Answers from your own notes,
          <br className="hidden sm:block" /> down to the page.
        </h1>

        <p className="mt-6 max-w-[680px] body-3 text-muted-foreground sm:title-2 sm:font-normal">
          Upload your lecture notes and previous year papers. StudyMate answers your questions using only
          what&apos;s in them, and shows you exactly where each answer came from.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/register">Create new account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
      >
        <AnswerDemo />
      </motion.div>
    </section>
  );
}
