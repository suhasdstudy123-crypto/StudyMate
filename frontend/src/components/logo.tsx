import Link from "next/link";

import { cn } from "@/lib/utils";

/* The mark: a page of notes with one line highlighted. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect x="6" y="3" width="20" height="26" rx="3" className="fill-card stroke-foreground" strokeWidth="2" />
      <rect x="9" y="13" width="14" height="5" rx="1.5" className="fill-highlight" />
      <path d="M10.5 9h11M10.5 15.5h11M10.5 22h7" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2 rounded-md text-lg font-extrabold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <LogoMark />
      StudyMate
    </Link>
  );
}
