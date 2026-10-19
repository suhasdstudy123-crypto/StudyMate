import type { Metadata } from "next";

// Fonts come from npm packages (Fontsource), so they're served from our own
// site: no request to Google on page load, and they work offline.
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "StudyMate",
    template: "%s | StudyMate", // pages set title: "Log in" -> "Log in | StudyMate"
  },
  description:
    "Upload your lecture notes and previous-year papers, ask questions, and get answers from your own material with the page they came from.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes adds class="dark" in the browser
    // before React starts, so the server HTML and browser HTML differ on
    // purpose here. This tells React not to warn about that one attribute.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
