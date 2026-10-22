import { MotionConfig } from "motion/react";

import { LogoMark } from "@/components/logo";
import { FileMarquee } from "@/components/landing/file-marquee";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HonestAnswers } from "@/components/landing/honest-answers";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SiteHeader } from "@/components/landing/site-header";

/*
  Landing page (logged-out home). This file only arranges the sections.
  Each section is its own component in components/landing/, so each one
  is small enough to read on its own.

  MotionConfig reducedMotion="user": if the visitor's OS has
  "reduce motion" turned on, every motion animation is skipped.
*/
export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Hero />
          <FileMarquee />
          <HowItWorks />
          <HonestAnswers />
          <FinalCta />
        </main>
        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:px-8">
            <span className="inline-flex items-center gap-2 font-semibold text-foreground">
              <LogoMark className="size-5" />
              StudyMate
            </span>
            <span>© {new Date().getFullYear()} StudyMate</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
