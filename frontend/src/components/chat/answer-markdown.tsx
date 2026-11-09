"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

import type { ChatSource } from "@/lib/chat";
import { cn } from "@/lib/utils";

/*
  Renders an answer: Markdown (lists, bold, code, TABLES via remark-gfm),
  formulas via KaTeX ($...$ and $$...$$ -> remark-math finds them,
  rehype-katex draws them), and every citation [n] as a small button.

  Why react-markdown and not dangerouslySetInnerHTML with an HTML string?
  react-markdown builds React elements and never injects raw HTML, so an
  answer (which partly echoes the student's notes) can't smuggle in a
  <script>: no XSS through the chat.

  Citations: "[2]" in Markdown would be plain text, and "[2][5]" even means
  "a reference link" to Markdown. So before rendering, every [n] outside code
  becomes a link to "#cite-n", and our own <a> renderer turns those links
  into citation chips.
*/

const CITE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
// Code (fenced or inline) is left alone: "[1]" inside SQL is not a citation.
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

export function linkCitations(markdown: string): string {
  return markdown
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(CITE, (_, nums: string) =>
            nums
              .split(",")
              .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
              .join(""),
          ),
    )
    .join("");
}

type Props = {
  text: string;
  sources: ChatSource[];
  /** the citation currently selected (its chip is highlighted) */
  activeN?: number | null;
  onCite: (n: number) => void;
  className?: string;
};

/*
  The chip reads sources/selection/click handler from a context instead of
  props: the Markdown renderers below are then created ONCE, so React keeps
  the same chip elements while new text streams in. (Renderers re-created on
  every render would make React rebuild every chip, restarting its pop-in
  animation on each new piece of text.)
*/
type CiteState = { byN: Map<number, ChatSource>; activeN: number | null; onCite: (n: number) => void };
const CiteContext = createContext<CiteState>({ byN: new Map(), activeN: null, onCite: () => {} });

function CiteOrLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const { byN, activeN, onCite } = useContext(CiteContext);
  if (href?.startsWith("#cite-")) {
    const n = Number(href.slice(6));
    const src = byN.get(n);
    // A number the model made up (no such passage): show it, but not as a link.
    if (!src) return <span className="text-muted-foreground">[{n}]</span>;
    const where = `${src.material_title} · page ${src.page_number}`;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCite(n);
        }}
        title={where}
        aria-label={`Source ${n}: ${where}`}
        className={cn(
          "cite-chip mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-full px-1 align-middle text-[0.68rem] font-bold tabular-nums transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
          activeN === n
            ? "bg-highlight text-highlight-foreground"
            : "bg-primary/12 text-primary hover:bg-highlight hover:text-highlight-foreground",
        )}
      >
        {n}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
      {children}
    </a>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <CiteOrLink href={href}>{children}</CiteOrLink>,
  // Wide tables scroll sideways inside the answer instead of breaking the page.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border">
      <table>{children}</table>
    </div>
  ),
};
const REMARK = [remarkGfm, remarkMath];
const REHYPE = [rehypeKatex];

export const AnswerMarkdown = memo(function AnswerMarkdown({ text, sources, activeN = null, onCite, className }: Props) {
  const linked = useMemo(() => linkCitations(text), [text]);
  // Keep the latest click handler in a ref, so a new function from the parent
  // on every render doesn't change the context value.
  const onCiteRef = useRef(onCite);
  useEffect(() => {
    onCiteRef.current = onCite;
  });
  const stableOnCite = useCallback((n: number) => onCiteRef.current(n), []);
  const cite = useMemo(
    () => ({ byN: new Map(sources.map((s) => [s.n, s])), activeN, onCite: stableOnCite }),
    [sources, activeN, stableOnCite],
  );

  return (
    <CiteContext.Provider value={cite}>
      <div className={cn("answer-prose", className)}>
        <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
          {linked}
        </ReactMarkdown>
      </div>
    </CiteContext.Provider>
  );
});
