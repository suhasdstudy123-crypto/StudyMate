"use client";

import { motion } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function HonestAnswers() {
  return (
    <section className="border-y bg-card" aria-labelledby="honest-heading">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <motion.div
          className="max-w-lg"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <h2 id="honest-heading" className="heading-5 sm:heading-4">
            If it isn&apos;t in your notes, it says so.
          </h2>
          <p className="mt-4 body-3 text-muted-foreground">
            StudyMate never fills gaps with a confident guess. When your material doesn&apos;t cover a
            question, you&apos;re told plainly, so you know what to go and read.
          </p>
        </motion.div>

        <motion.div
          className="rounded-xl border bg-background p-4 sm:p-6"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
        >
          <p className="ml-auto w-fit max-w-[90%] rounded-lg bg-muted px-3 py-2 body-3">Who proposed the B+ tree?</p>
          <motion.div
            className="mt-6 rounded-lg border bg-card p-4"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.6, delay: 0.6, ease: EASE }}
          >
            <p className="title-4">Not in your notes</p>
            <p className="mt-1 body-3 text-muted-foreground">
              Your DBMS notes don&apos;t mention who proposed the B+ tree. They do cover how B+ trees are
              structured and searched, if you&apos;d like to ask about that.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
