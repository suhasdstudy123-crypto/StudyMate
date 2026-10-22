"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // The server can't know your theme (it lives in your browser), so on the
  // server and on the browser's FIRST render we show a neutral label.
  // useSyncExternalStore gives the server snapshot (false) during the
  // server render AND the browser's first (hydration) render, then switches
  // to the client snapshot (true). So the theme-specific label appears only
  // once both sides already agree.
  // Without this, the server said "Switch to dark mode", the browser said
  // "Switch to light mode", and React reported a hydration mismatch.
  const mounted = useSyncExternalStore(
    () => () => {}, // nothing to subscribe to
    () => true,     // in the browser
    () => false,    // on the server
  );

  const isDark = mounted && resolvedTheme === "dark";
  const label = !mounted ? "Toggle theme" : isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button variant="ghost" size="icon" aria-label={label} onClick={() => setTheme(isDark ? "light" : "dark")}>
      {/* Both icons are always rendered; CSS shows the right one, so the
          icon is correct even before the browser knows the theme. */}
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  );
}
