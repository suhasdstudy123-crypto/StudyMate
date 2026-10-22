"use client";

import { motion } from "motion/react";

import { Mascot } from "@/components/mascot";

export function HonestAnswers() {
  return (
    <section className="border-y bg-card/50" aria-labelledby="honest-heading">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <motion.div
          className="max-w-lg"
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h2 id="honest-heading" className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            If it isn&apos;t in your notes, it says so.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            StudyMate never fills gaps with a confident guess. When your material doesn&apos;t cover a
            question, you&apos;re told plainly, so you know what to go and read.
          </p>
        </motion.div>

        <div className="flex items-end gap-3 sm:gap-5">
          <motion.div
            className="shrink-0"
            initial={{ opacity: 0, y: 30, rotate: -8 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ type: "spring", stiffness: 160, damping: 14, delay: 0.2 }}
          >
            <Mascot mood="confused" className="w-20 sm:w-28" />
          </motion.div>

          <div className="flex-1 rounded-lg border bg-card p-5 shadow-[0_1px_0_var(--rule),0_20px_40px_-24px_rgb(23_31_77/0.35)] sm:p-6">
            <motion.p
              className="ml-auto w-fit max-w-[90%] rounded-lg rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground"
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              Who proposed the B+ tree?
            </motion.p>
            <motion.p
              className="mt-5 leading-relaxed"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.5, delay: 1.1 }}
            >
              Your DBMS notes don&apos;t mention who proposed the B+ tree. They do cover how B+ trees are
              structured and searched, if you&apos;d like to ask about that.
            </motion.p>
          </div>
        </div>
      </div>
    </section>
  );
}
