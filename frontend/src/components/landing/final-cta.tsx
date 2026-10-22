"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
      <motion.div
        // class "dark" switches the colour tokens to their dark values inside
        // this panel only, so Marky gets light outlines on the dark background.
        className="dark relative overflow-hidden rounded-lg px-6 py-12 text-white sm:px-12 sm:py-16"
        style={{ background: "#1b2459" }}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
      >
        {/* the same notebook grid, faint, on the dark panel */}
        <div aria-hidden="true" className="grid-paper pointer-events-none absolute inset-0 opacity-20" />

        <div className="relative flex flex-col items-start gap-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-balance sm:text-5xl">
              Your notes have the answers. Let&apos;s find them.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-white/75">
              Create an account, make a course, and upload your first PDF. It takes about a minute.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-8 bg-white text-[#171f4d] transition-transform hover:-translate-y-0.5 hover:bg-white/90"
            >
              <Link href="/register">Create free account</Link>
            </Button>
          </div>
          <Mascot mood="wave" className="w-32 self-center sm:w-40 md:self-auto" />
        </div>
      </motion.div>
    </section>
  );
}
