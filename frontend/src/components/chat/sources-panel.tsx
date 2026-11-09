"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { ArrowRight, FileText, ScanEye, Table2, Workflow } from "lucide-react";

import type { ChatSource } from "@/lib/chat";
import { cn } from "@/lib/utils";

/*
  The passages behind one answer, numbered like the citations [n].
  Cited passages are marked with the highlighter (yellow = text the answer
  relies on); passages the model was shown but didn't use are dimmed:
  "shown, not cited". Clicking "Open page" shows the passage on its page.
*/

type Props = {
  sources: ChatSource[];
  /** numbers cited by the answer (while streaming: what has arrived so far) */
  cited: Set<number>;
  activeN: number | null;
  onSelect: (n: number) => void;
  onOpen: (source: ChatSource) => void;
};

export function SourcesPanel({ sources, cited, activeN, onSelect, onOpen }: Props) {
  const refs = useRef(new Map<number, HTMLElement>());

  // Clicking a citation in the answer scrolls its passage into view here.
  useEffect(() => {
    if (activeN !== null) refs.current.get(activeN)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeN]);

  if (sources.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">No passages were found for this question.</p>;
  }

  // Cited first (in number order), then the rest: what the answer stands on comes first.
  const ordered = [...sources].sort((a, b) => Number(cited.has(b.n)) - Number(cited.has(a.n)) || a.n - b.n);

  return (
    <ol className="grid grid-cols-1 gap-2.5">
      {ordered.map((s, i) => {
        const isCited = cited.has(s.n);
        const active = activeN === s.n;
        return (
          <motion.li
            key={s.chunk_id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.03 }}
            ref={(el: HTMLElement | null) => {
              if (el) refs.current.set(s.n, el);
              else refs.current.delete(s.n);
            }}
          >
            <article
              onClick={() => onSelect(s.n)}
              className={cn(
                "group cursor-pointer rounded-md border bg-card p-3 transition-[border-color,box-shadow,opacity]",
                active ? "border-primary ring-2 ring-primary/25" : "hover:border-primary/50",
                !isCited && !active && "opacity-70 hover:opacity-100",
              )}
            >
              <header className="flex items-start gap-2">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums",
                    isCited ? "bg-highlight text-highlight-foreground" : "bg-muted text-muted-foreground",
                  )}
                  aria-label={`Source ${s.n}`}
                >
                  {s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate" title={s.material_title}>
                      {s.material_title}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-muted-foreground">
                    <span className="tabular-nums">page {s.page_number}</span>
                    {s.chunk_type === "table" && (
                      <span className="inline-flex items-center gap-0.5">
                        <Table2 className="size-3" aria-hidden="true" /> table
                      </span>
                    )}
                    {s.chunk_type === "diagram" && (
                      <span className="inline-flex items-center gap-0.5">
                        <Workflow className="size-3" aria-hidden="true" /> diagram
                      </span>
                    )}
                    {s.source === "vision" && (
                      <span className="inline-flex items-center gap-0.5 text-primary" title="Read from a picture by the image reader: check it on the page">
                        <ScanEye className="size-3" aria-hidden="true" /> from an image
                      </span>
                    )}
                    <span className={cn("font-semibold", isCited ? "text-foreground" : "")}>
                      {isCited ? "cited" : "shown, not cited"}
                    </span>
                  </p>
                </div>
              </header>
              <p className={cn("mt-2 font-serif text-[0.85rem] leading-snug", active ? "" : "line-clamp-3")}>
                {s.content}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(s);
                }}
                className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open page {s.page_number}
                <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </article>
          </motion.li>
        );
      })}
    </ol>
  );
}
