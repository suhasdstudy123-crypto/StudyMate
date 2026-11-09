"use client";

import { AnimatePresence, motion } from "motion/react";

import { Logo } from "@/components/logo";
import { Mascot, type MascotMood } from "@/components/mascot";
import { ThemeToggle } from "@/components/theme-toggle";

const EASE = [0.22, 1, 0.36, 1] as const;

/*
  Shared frame for the login and register pages:
    left  = the form
    right = a quiet grey panel with Marky reacting to what you do
  On phones the panel is hidden and a small Marky sits above the form.

  The page tells the shell how Marky should behave:
    mood     -> pose (idle, shy while typing a password, happy on success...)
    reading  -> 0..1 while typing the email: his eyes follow along the text
    line     -> what he says (one short line under him)
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
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------- left: the form ---------- */}
      <div className="flex flex-col px-4 py-4 sm:px-8">
        <div className="flex h-10 items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>

        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {/* phone-size Marky, with his line beside him */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Shake shakeKey={shakeKey}>
              <Mascot mood={mood} gaze={mobileGaze} className="w-12" />
            </Shake>
            <MarkyLine line={line} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <h1 className="heading-4">{title}</h1>
            <p className="mt-2 body-3 text-muted-foreground">{subtitle}</p>
          </motion.div>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.06, ease: EASE }}
          >
            {children}
          </motion.div>

          <p className="mt-8 body-6 text-muted-foreground">{footer}</p>
        </main>
      </div>

      {/* ---------- right: a quiet panel with Marky (desktop) ---------- */}
      <aside className="hidden border-l bg-muted lg:block">
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
          <Shake shakeKey={shakeKey}>
            <Mascot mood={mood} gaze={desktopGaze} className="w-40" />
          </Shake>
          <MarkyLine line={line} center />
          <p className="max-w-xs text-center caption-2 text-muted-foreground">
            Marky only answers from the notes you upload. No guessing.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* What Marky says, as plain text (not a speech bubble), fading between lines. */
function MarkyLine({ line, center }: { line: string; center?: boolean }) {
  return (
    <div className={center ? "min-h-7 text-center" : "min-h-5"} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={line}
          className={center ? "title-2" : "title-4"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
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
      animate={shakeKey > 0 ? { x: [0, -8, 7, -5, 3, 0] } : undefined}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
