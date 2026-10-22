"use client";

import { AnimatePresence, motion } from "motion/react";

import { Logo } from "@/components/logo";
import { Mascot, type MascotMood } from "@/components/mascot";
import { ThemeToggle } from "@/components/theme-toggle";

/*
  Shared frame for the login and register pages:
    left  = the form
    right = a dark panel with a big Marky reacting to what you do
  On phones the panel is hidden and a smaller Marky sits above the form.

  The page tells the shell how Marky should behave:
    mood     -> pose (idle, shy while typing a password, happy on success...)
    reading  -> 0..1 while typing the email: his eyes follow along the text
    line     -> what his speech bubble says
    shakeKey -> change this number to make him shake (wrong password)
*/

type Props = {
  title: string;
  subtitle: string;
  mood: MascotMood;
  reading: number | null;
  line: string;
  shakeKey: number;
  children: React.ReactNode;
  footer: React.ReactNode;
};

export function AuthShell({ title, subtitle, mood, reading, line, shakeKey, children, footer }: Props) {
  // Marky is to the RIGHT of the form on desktop (look left),
  // and ABOVE it on phones (look down).
  const desktopGaze: [number, number] | null = reading === null ? null : [-1 + reading * 0.7, 0.45];
  const mobileGaze: [number, number] | null = reading === null ? null : [-0.7 + reading * 1.4, 1];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ---------- left: the form ---------- */}
      <div className="flex flex-col px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>

        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {/* phone-size Marky */}
          <div className="mb-6 flex items-end gap-3 lg:hidden">
            <Shake shakeKey={shakeKey}>
              <Mascot mood={mood} gaze={mobileGaze} className="w-20" />
            </Shake>
            <SpeechBubble line={line} className="mb-8" />
          </div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-4xl font-extrabold tracking-[-0.03em]">{title}</h1>
            <p className="mt-2 text-muted-foreground">{subtitle}</p>
          </motion.div>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
          >
            {children}
          </motion.div>

          <p className="mt-8 text-sm text-muted-foreground">{footer}</p>
        </main>
      </div>

      {/* ---------- right: Marky's panel (desktop) ---------- */}
      {/* class "dark": colour tokens switch to dark values inside the panel */}
      <aside className="dark relative hidden overflow-hidden text-white lg:block" style={{ background: "#1b2459" }}>
        <div aria-hidden="true" className="grid-paper pointer-events-none absolute inset-0 opacity-25" />
        <div className="relative flex h-full flex-col items-center justify-center px-10">
          <SpeechBubble line={line} className="mb-6" large />
          <Shake shakeKey={shakeKey}>
            <Mascot mood={mood} gaze={desktopGaze} className="w-64 xl:w-72" />
          </Shake>
          <p className="mt-10 max-w-xs text-center text-white/60">
            Marky only answers from the notes you upload. No guessing.
          </p>
        </div>
      </aside>
    </div>
  );
}

function SpeechBubble({ line, className, large }: { line: string; className?: string; large?: boolean }) {
  return (
    <div className={className} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={line}
          className={
            large
              ? "rounded-lg rounded-b-sm border bg-card px-5 py-3 text-lg font-semibold text-foreground shadow-lg"
              : "rounded-lg rounded-bl-sm border bg-card px-3.5 py-2 text-sm font-medium shadow-sm"
          }
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          {line}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/* Re-mounting with a new key replays the shake animation. */
function Shake({ shakeKey, children }: { shakeKey: number; children: React.ReactNode }) {
  return (
    <motion.div
      key={shakeKey}
      animate={shakeKey > 0 ? { x: [0, -12, 11, -8, 6, -3, 0] } : undefined}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.div>
  );
}
