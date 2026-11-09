"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
      <motion.div
        className="flex flex-col items-start gap-6 rounded-xl border bg-card p-6 sm:p-12 md:flex-row md:items-end md:justify-between"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="max-w-xl">
          <h2 className="heading-5 sm:heading-4">Your notes have the answers. Let&apos;s find them.</h2>
          <p className="mt-3 body-3 text-muted-foreground">
            Create an account, make a course, and upload your first PDF. It takes about a minute.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/register">Create new account</Link>
        </Button>
      </motion.div>
    </section>
  );
}
