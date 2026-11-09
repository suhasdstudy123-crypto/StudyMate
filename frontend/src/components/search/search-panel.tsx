"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FileText, Info, Loader2, ScanEye, Search, Sparkles, Table2, WholeWord, Workflow, X } from "lucide-react";

import { MarkdownTable, splitFences } from "@/components/materials/pages-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { MAX_QUERY_CHARS, queryStems, searchCourse, type SearchHit, type SearchResponse } from "@/lib/search";
import { cn } from "@/lib/utils";

/*
  "Search your notes" on the course page (Stage 6).

    type a question -> Enter -> GET /api/courses/{id}/search
                             -> passage cards: file, page, how it was found

  Search runs when the student presses Enter or the button, not on every
  keystroke: each search embeds the question with the model (~0.05 s on a
  GPU, ~0.3 s on a CPU), and half-typed questions would waste that work.

  Each card says HOW it was found (by meaning, by keywords, or both): that
  makes hybrid search visible, and explains why a passage without your exact
  words can still be the best answer.
*/

type Props = {
  courseId: string;
  /** searchable passages in this course, shown under the box */
  passages: number;
  /** open "What StudyMate read" at this page, with this passage marked */
  onOpenPage: (hit: SearchHit) => void;
};

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "done"; data: SearchResponse }
  | { kind: "error"; message: string };

export function SearchPanel({ courseId, passages, onOpenPage }: Props) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the LATEST search may show its results: if an older, slower request
  // answers after a newer one, its answer is ignored.
  const latest = useRef(0);
  const hintId = useId();

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = text.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    const mine = ++latest.current;
    setState({ kind: "loading", query: q });
    try {
      const data = await searchCourse(courseId, q);
      if (mine === latest.current) setState({ kind: "done", data });
    } catch (err) {
      if (mine === latest.current) {
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Search failed. Try again." });
      }
    }
  }

  function clear() {
    latest.current++; // ignore any search still on its way
    setText("");
    setState({ kind: "idle" });
    inputRef.current?.focus();
  }

  return (
    <section aria-labelledby="search-heading" className="grid grid-cols-1 gap-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="grid gap-3">
          <h2 id="search-heading" className="title-3">
            Search your notes
          </h2>
          <form onSubmit={run} role="search" className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && text && clear()}
                maxLength={MAX_QUERY_CHARS}
                placeholder="e.g. why can money disappear if the server crashes mid-transfer?"
                aria-label="Search your notes"
                aria-describedby={hintId}
                enterKeyHint="search"
                className="h-10 w-full min-w-0 rounded-lg border border-input bg-background pr-10 pl-10 body-3 outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 sm:body-6"
              />
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              {text && (
                <button
                  type="button"
                  onClick={clear}
                  className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear the search"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <Button type="submit" variant="outline" disabled={state.kind === "loading"} className="sm:w-28">
              {state.kind === "loading" && <Loader2 className="animate-spin" aria-hidden="true" />}
              Search
            </Button>
          </form>
          <p id={hintId} className="caption-2 text-muted-foreground">
            Ask in your own words, or type an exact term like an error code. Searches {passages}{" "}
            {passages === 1 ? "passage" : "passages"} by meaning and by keywords.
          </p>
        </div>
      </div>

      <div aria-live="polite" className="grid grid-cols-1 gap-3">
        {state.kind === "loading" && <LoadingCards />}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 body-5">
            {state.message}
          </p>
        )}
        {state.kind === "done" && <Results data={state.data} onOpenPage={onOpenPage} />}
      </div>
    </section>
  );
}

function Results({ data, onOpenPage }: { data: SearchResponse; onOpenPage: (hit: SearchHit) => void }) {
  const stems = useMemo(() => queryStems(data.query), [data.query]);

  if (data.results.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-8 text-center">
        <p className="title-3">Nothing in your notes matches “{data.query}”.</p>
        <p className="mt-1 max-w-md body-6 text-muted-foreground">
          Try other words. If you just uploaded a file, it may still be being read.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="caption-2 text-muted-foreground">
        <span className="caption-1 text-foreground">
          {data.results.length} {data.results.length === 1 ? "passage" : "passages"}
        </span>{" "}
        for “{data.query}” · {data.took_ms < 1000 ? `${data.took_ms} ms` : `${(data.took_ms / 1000).toFixed(1)} s`} ·{" "}
        {data.mode === "hybrid" ? "by meaning and keywords" : "by keywords only"}
      </p>
      {data.mode === "keywords" && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 body-6">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="body-4">Meaning search is still warming up</span>{" "}
            <span className="text-muted-foreground">
              (the model loads for a few seconds after the server starts). These results only match your exact words;
              search again in a moment.
            </span>
          </span>
        </p>
      )}
      {data.mode === "hybrid" && data.results.every((r) => r.keyword_rank === null) && (
        // Meaning search ALWAYS returns its nearest passages, even when nothing
        // is really about the question. If none of them contains any of the
        // question's words, say so instead of pretending they're answers.
        <div className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 body-6">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="body-4">None of these passages contains your words.</span>{" "}
            <span className="text-muted-foreground">
              They are only the closest in meaning, so your notes may not cover this. Try other words.
            </span>
          </p>
        </div>
      )}
      <ol className="grid grid-cols-1 divide-y overflow-hidden rounded-xl border bg-card">
        <AnimatePresence initial>
          {data.results.map((hit, i) => (
            <motion.li
              key={hit.chunk_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: Math.min(i, 6) * 0.04, ease: [0.22, 1, 0.36, 1] }}
            >
              <ResultCard hit={hit} position={i + 1} stems={stems} onOpen={() => onOpenPage(hit)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </>
  );
}

function ResultCard({
  hit,
  position,
  stems,
  onOpen,
}: {
  hit: SearchHit;
  position: number;
  stems: string[];
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = hit.content.length > 520 || hit.chunk_type === "table";

  return (
    <article className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 p-4 sm:gap-x-4">
      {/* rank number: plain, in the margin */}
      <span className="w-5 pt-0.5 text-right caption-4 tabular-nums text-muted-foreground" aria-label={`Result ${position}`}>
        {position}
      </span>

      <div className="grid min-w-0 gap-2">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 caption-2">
          <span className="inline-flex min-w-0 items-center gap-1 title-4">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{hit.material_title}</span>
          </span>
          <span className="caption-4 tabular-nums text-muted-foreground">p. {hit.page_number}</span>
          {hit.chunk_type === "table" && <Tag icon={Table2}>table</Tag>}
          {hit.chunk_type === "diagram" && <Tag icon={Workflow}>diagram</Tag>}
          {hit.source === "vision" && (
            // Same honest label as the reading viewer; dashed ink, never highlighter yellow.
            <span className="inline-flex items-center gap-1 caption-4 text-muted-foreground">
              <ScanEye className="size-3.5" aria-hidden="true" />
              Read from an image, check it
            </span>
          )}
          <span className="flex w-full flex-wrap gap-3 sm:ml-auto sm:w-auto">
            {hit.meaning_rank !== null && (
              <FoundBy
                icon={Sparkles}
                title={`Close in meaning to your question (similarity ${Math.round((hit.similarity ?? 0) * 100)}%)`}
              >
                meaning #{hit.meaning_rank}
              </FoundBy>
            )}
            {hit.keyword_rank !== null && (
              <FoundBy icon={WholeWord} title="Contains words from your question (rare words count more)">
                keywords #{hit.keyword_rank}
              </FoundBy>
            )}
          </span>
        </header>

        <div
          className={cn(
            "relative",
            long && !expanded && "max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
          )}
        >
          {hit.chunk_type === "table" ? (
            <div className="rounded-md">
              <MarkdownTable content={hit.content} />
            </div>
          ) : (
            <div className="grid gap-2 font-serif text-base leading-7">
              {splitFences(hit.content).map((block, i) =>
                block.code !== null ? (
                  <pre key={i} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-5">
                    {block.code}
                  </pre>
                ) : (
                  <p key={i} className={cn(hit.source === "vision" && "whitespace-pre-line")}>
                    <Bolded text={block.text ?? ""} stems={stems} />
                  </p>
                ),
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="rounded-md body-5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md body-5 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open page {hit.page_number}
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </footer>
      </div>
    </article>
  );
}

function Tag({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 caption-4 text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

function FoundBy({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 caption-5 text-muted-foreground"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
      <span className="sr-only">. {title}</span>
    </span>
  );
}

/*
  The passage with the question's words in bold. Bold + an ink underline,
  not the yellow highlighter: yellow is reserved for text the chat CITES.
*/
function Bolded({ text, stems }: { text: string; stems: string[] }) {
  if (!stems.length) return <>{text}</>;
  const escaped = stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A word that STARTS with one of the stems: "transact" bolds "transactions".
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})[\\p{L}\\p{N}]*`, "giu");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <strong key={start} className="font-semibold text-foreground underline decoration-foreground/30 decoration-1 underline-offset-4">
        {m[0]}
      </strong>,
    );
    last = start + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function LoadingCards() {
  return (
    <div className="grid divide-y overflow-hidden rounded-xl border bg-card" aria-busy="true" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[auto_1fr] gap-3 p-4">
          <div className="skeleton size-5 rounded" />
          <div className="grid gap-2">
            <div className="skeleton h-4 w-1/2 rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-5/6 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
