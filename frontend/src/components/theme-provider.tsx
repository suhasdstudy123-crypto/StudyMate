"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/*
  next-themes adds class="dark" to <html> when dark mode is on, remembers
  the choice in localStorage, and follows the OS setting by default.
  "use client": it needs the browser (localStorage, the OS preference),
  so it must run in the browser, not only on the server.
*/
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
