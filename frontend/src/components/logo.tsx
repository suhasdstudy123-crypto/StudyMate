import Link from "next/link";

import { cn } from "@/lib/utils";

/* The mark: a page of notes, drawn as one solid shape so it reads at small sizes. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6", className)}>
      <rect x="6" y="3" width="20" height="26" rx="4" className="fill-foreground" />
      <path d="M11 10h10M11 16h10M11 22h6" className="stroke-background" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg heading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <LogoMark />
      StudyMate
    </Link>
  );
}
