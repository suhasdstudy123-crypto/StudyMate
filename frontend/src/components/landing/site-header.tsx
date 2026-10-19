"use client";

import Link from "next/link";
import { motion, useScroll, useSpring } from "motion/react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  // scrollYProgress goes 0 -> 1 as you scroll from top to bottom of the page.
  // useSpring smooths it so the bar glides instead of jumping.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });

  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Create account</Link>
          </Button>
        </nav>
      </div>
      {/* Reading-progress bar: a highlighter stroke across the top */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-highlight"
        style={{ scaleX: progress }}
      />
    </header>
  );
}
