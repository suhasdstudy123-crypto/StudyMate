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
  and formulas becomes a link to "#cite-n", and our own <a> renderer turns
  those links into citation chips.
*/

const CITE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
// Code (fenced or inline) is left alone: "[1]" inside SQL is not a citation.
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
/*
  Formulas: $$...$$ (display) or $...$ (inline, one line). A "\$" is an
  escaped dollar sign, not a formula.
*/
const MATH = /(\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\$)[^\n$]+?\$)/g;
// Citations the model put at the END of a formula, just before the closing $ / $$.
// A citation follows a space ("... C) [3]$"); "x[2]$" with no space is maths (an index).
// Groups: 1 = the citations, 2 = whitespace before the closing delimiter (kept), 3 = "$" or "$$".
const CITES_AT_END = /(\s+\[\d+(?:\s*,\s*\d+)*\](?:\s*\[\d+(?:\s*,\s*\d+)*\])*)(\s*)(\$\$?)$/;

const citeLinks = (nums: string) =>
  nums
    .split(",")
    .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
    .join("");

/*
  LLMs often write formulas as \( ... \) and \[ ... \] (LaTeX style), but
  remark-math only understands $...$ and $$...$$. Convert them. (?<!\\)
  skips "\\[2pt]", a LaTeX line break with extra spacing, not a formula.
*/
function normaliseMathDelimiters(text: string): string {
  return text
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_, body: string) => `$$${body}$$`)
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_, body: string) => `$${body}$`);
}

/*
  A citation INSIDE a formula ("$A = \tanh(...) [3]$") is not LaTeX: turned
  into a link it made KaTeX fail and print the raw formula in red. So a
  citation at the end of a formula is moved just after it. Elsewhere inside
  a formula "[1]" is left alone: it may be real maths, like an index x[1].
*/
function linkOutsideMath(text: string): string {
  return normaliseMathDelimiters(text)
    .split(MATH)
    .map((part, i) => {
      if (i % 2 === 0) return part.replace(CITE, (_, nums: string) => citeLinks(nums));
      const m = part.match(CITES_AT_END);
      if (!m) return part;
      const moved = [...m[1].matchAll(CITE)].map((c) => citeLinks(c[1])).join("");
      const [, , space, close] = m;
      // A multi-line "$$" block: its closing "$$" must stay alone on its line, so the
      // citations go on the next line, indented like the fence (keeps a list item whole).
      if (space.includes("\n")) {
        const indent = space.slice(space.lastIndexOf("\n") + 1);
        return part.slice(0, m.index) + space + close + "\n" + indent + moved;
      }
      return part.slice(0, m.index) + close + " " + moved;
    })
    .join("");
}

/*
  "$$...$$" in the MIDDLE of a sentence is treated as inline maths, so a
  multi-line formula (aligned equations) gets squeezed into the text line.
  Give such formulas their own lines, indented like the line they were on so
  a numbered list stays one list. Only multi-line maths (\begin{...} or \\)
  is moved: "$$5 or $$10" stays as it was. A line that is ONLY "$$...$$" also
  gets its own fences, so it is drawn centred as a display formula.
  Lines inside ``` code are skipped.
*/
const MULTILINE_MATH_MID_LINE = /(\S[^\n]*?)?\s*\$\$([^$\n]*?(?:\\begin\{|\\\\)[^$\n]*?)\$\$[ \t]*/g;
const WHOLE_LINE_MATH = /^(\s*)\$\$([^$\n]+?)\$\$\s*$/;

function liftDisplayMath(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence || !line.includes("$$")) return line;
      const whole = line.match(WHOLE_LINE_MATH);
      if (whole) return `${whole[1]}$$\n${whole[1]}${whole[2].trim()}\n${whole[1]}$$`;
      // continuation indent: as wide as "3. " for a list item, else the line's own indent
      const marker = line.match(/^\s*(?:[-*+]|\d+[.)])\s+/);
      const indent = marker ? " ".repeat(marker[0].length) : (line.match(/^\s*/)?.[0] ?? "");
      return line.replace(
        MULTILINE_MATH_MID_LINE,
        (_, before: string | undefined, body: string) =>
          // no text before it (formula starts the line): no empty line in front
          `${before ? `${before}\n` : ""}${indent}$$\n${indent}${body.trim()}\n${indent}$$\n${indent}`,
      );
    })
    .join("\n");
}

export function linkCitations(markdown: string): string {
  return liftDisplayMath(markdown)
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : linkOutsideMath(part)))
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
          // A small square tag, not a round pill. Yellow only when it points at
          // the passage being shown: yellow always means "from your notes".
          "cite-chip mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded px-1 align-middle caption-3 tabular-nums transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
          activeN === n
            ? "bg-highlight text-highlight-foreground"
            : "bg-muted text-foreground ring-1 ring-border ring-inset hover:bg-highlight hover:text-highlight-foreground",
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
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table>{children}</table>
    </div>
  ),
};
const REMARK = [remarkGfm, remarkMath];
/*
  If a formula still can't be parsed, KaTeX shows its source instead of
  failing the whole answer. errorColor makes that fallback quiet grey (see
  .katex-error in globals.css) instead of alarm red.
*/
const REHYPE: [typeof rehypeKatex, { errorColor: string }][] = [[rehypeKatex, { errorColor: "var(--ink-soft)" }]];

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
