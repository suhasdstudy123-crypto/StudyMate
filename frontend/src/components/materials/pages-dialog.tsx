"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, ImageOff, Loader2, RotateCw, ScanEye, Table2, Workflow } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import {
  getPage,
  listPages,
  pageImageUrl,
  retryFailedPages,
  type Chunk,
  type Material,
  type PageDetail,
  type PageSummary,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

/*
  "What StudyMate read": the file page by page, exactly as it is stored.

    left:  every page, with markers for tables and for pages that have
           pictures the text reader can't see
    right: the passages (chunks) of the selected page, in order, and for
           pages the image reader reads, the page picture it is sent

  This is the same text that search (Stage 6) and the chat (Stage 7)
  use, so it's the place to check that a PDF was read correctly. Search
  results open it at their page, with the found passage marked.
  Text from your notes is shown in the serif font, the app's rule for
  "this came from your documents".
*/
type Props = {
  material: Material | null;
  onClose: () => void;
  /** Open at this page (default 1), e.g. from a search result */
  initialPage?: number;
  /** Mark this passage and scroll to it (the search result that was clicked) */
  focusChunkId?: string | null;
  // Tells the course page when this file changed here (failed pages retried),
  // so the file row updates at once instead of on the next page load.
  onChanged: (m: Material) => void;
};

export function PagesDialog({ material, onClose, onChanged, initialPage = 1, focusChunkId = null }: Props) {
  return (
    <Dialog
      open={material !== null}
      onClose={onClose}
      title="What StudyMate read"
      description={material ? <span className="font-semibold text-foreground">{material.title}</span> : null}
      className="max-w-5xl"
    >
      {material && (
        // key: opening another file, or the same file at another page, starts a fresh viewer
        <Viewer
          key={`${material.id}-${initialPage}-${focusChunkId ?? ""}`}
          material={material}
          onChanged={onChanged}
          initialPage={initialPage}
          focusChunkId={focusChunkId}
        />
      )}
    </Dialog>
  );
}

function Viewer({
  material,
  onChanged,
  initialPage,
  focusChunkId,
}: {
  material: Material;
  onChanged: (m: Material) => void;
  initialPage: number;
  focusChunkId: string | null;
}) {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [current, setCurrent] = useState(initialPage);
  const listRef = useRef<HTMLOListElement>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Goes up every 5 s while the image reader is still working on this file,
  // so both effects below fetch again and new passages appear by themselves.
  const [tick, setTick] = useState(0);
  const reading = pages?.some((p) => p.vision_status === "pending" || p.vision_status === "processing") ?? false;
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, [reading]);

  // The page list: when the viewer opens (and on each tick while reading).
  useEffect(() => {
    let alive = true;
    listPages(material.id)
      .then((list) => alive && setPages(list))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Couldn't load the pages."));
    return () => {
      alive = false;
    };
  }, [material.id, tick]);

  // The selected page's passages: every time another page is picked (and on each tick).
  useEffect(() => {
    let alive = true;
    getPage(material.id, current)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Couldn't load this page."));
    return () => {
      alive = false;
    };
  }, [material.id, current, tick]);

  const loading = detail?.page.page_number !== current;

  // Opened at page 24 (from search): scroll the page list so "Page 24" is
  // visible, instead of leaving it at the top with page 1.
  const listReady = pages !== null;
  useEffect(() => {
    if (!listReady) return;
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [listReady]);

  return (
    // minmax(0, 1fr): the long strip of page buttons must not widen the grid (phones)
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
      {/* Page list: a column on wide screens, a scrolling strip on phones */}
      <nav aria-label="Pages" className="-mx-1 md:mx-0">
        <ol ref={listRef} className="flex gap-1.5 overflow-x-auto px-1 pb-2 md:max-h-[60vh] md:flex-col md:overflow-y-auto md:pr-2 md:pb-0">
          {(pages ?? []).map((p) => (
            <li key={p.page_number} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setCurrent(p.page_number);
                }}
                aria-current={p.page_number === current ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  p.page_number === current ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span className="tabular-nums">Page {p.page_number}</span>
                <span className="ml-auto flex items-center gap-1 opacity-80">
                  {p.table_count > 0 && <Table2 className="size-3.5" aria-label="has a table" />}
                  <PageVisionIcon page={p} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-live="polite" className="min-h-64 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : loading || !detail ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="Loading" />
          </div>
        ) : (
          <PageView
            materialId={material.id}
            detail={detail}
            focusChunkId={focusChunkId}
            onRetry={async () => {
              const updated = await retryFailedPages(material.id);
              onChanged(updated);
              setTick((n) => n + 1); // fetch again: the page is now waiting, and the refresh timer starts
            }}
          />
        )}
      </section>
    </div>
  );
}

/* The page list's marker: what the image reader has done with the page. */
function PageVisionIcon({ page }: { page: PageSummary }) {
  switch (page.vision_status) {
    case "done":
      return <ScanEye className="size-3.5" aria-label="read from its picture" />;
    case "processing":
      return <Loader2 className="size-3.5 animate-spin" aria-label="being read" />;
    case "failed":
      return <AlertTriangle className="size-3.5 text-destructive" aria-label="couldn't be read" />;
    case "pending":
      return <ImageOff className="size-3.5" aria-label="picture waiting to be read" />;
    default:
      return null;
  }
}

function PageView({
  materialId,
  detail,
  focusChunkId,
  onRetry,
}: {
  materialId: string;
  detail: PageDetail;
  focusChunkId: string | null;
  onRetry: () => Promise<void>;
}) {
  const { page, chunks } = detail;
  // The page picture loads AFTER the passages appear and pushes them down,
  // so the marked passage scrolls into view again once the picture is in.
  const [pictureLoaded, setPictureLoaded] = useState(false);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Page {page.page_number} · {chunks.length} {chunks.length === 1 ? "passage" : "passages"}
        {page.table_count > 0 && ` · ${page.table_count} ${page.table_count === 1 ? "table" : "tables"}`}
      </p>

      {page.vision_status !== "none" && <VisionNote page={page} onRetry={onRetry} />}

      {page.has_image && (
        // key: a new page = a new <img>, so the "loading" state starts over
        <PagePicture
          key={page.page_number}
          src={pageImageUrl(materialId, page.page_number)}
          page={page.page_number}
          onLoaded={() => setPictureLoaded(true)}
        />
      )}

      {chunks.length === 0 ? (
        <p className="rounded-md border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          No text on this page.
        </p>
      ) : (
        // Numbered within this page ("Passage 2 of 3"), not by the file-wide
        // chunk_index, which reads oddly on page 26 ("Passage 31").
        chunks.map((chunk, i) => (
          <ChunkCard
            key={chunk.id}
            chunk={chunk}
            position={i + 1}
            total={chunks.length}
            focused={chunk.id === focusChunkId}
            layoutKey={pictureLoaded}
          />
        ))
      )}
    </div>
  );
}

/*
  What the image reader has done with this page, in plain words.
  vision_status: pending | processing | done | failed  ("none" shows nothing)
*/
function VisionNote({ page, onRetry }: { page: PageSummary; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const what = page.needs_vision
    ? `This page has ${describeVisuals(page)}.`
    : "Thorough mode: this page is also read as a picture.";
  const status = {
    none: "",
    pending:
      "Text extraction can't see inside pictures, so only the text around them is below. The page is waiting for the image reader, which will read the picture below.",
    processing: "The image reader is reading the picture below right now.",
    done: "The image reader has read the picture below. Its passages are marked “Read from an image”: check them against the picture.",
    failed: `The image reader gave up on this page after several tries${page.vision_error ? `: ${page.vision_error}` : ""}.`,
  }[page.vision_status];

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed bg-muted/60 px-3.5 py-3 text-sm">
      {page.vision_status === "done" ? (
        <ScanEye className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : page.vision_status === "processing" ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <ImageOff
          className={cn("mt-0.5 size-4 shrink-0", page.vision_status === "failed" ? "text-destructive" : "text-muted-foreground")}
          aria-hidden="true"
        />
      )}
      <div className="grid gap-2">
        <p>
          <span className="font-semibold">{what}</span> <span className="text-muted-foreground">{status}</span>
        </p>
        {page.vision_status === "failed" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                setRetryError(null);
                try {
                  await onRetry();
                } catch (err) {
                  setRetryError(err instanceof ApiError ? err.message : "Couldn't start it again.");
                } finally {
                  setRetrying(false);
                }
              }}
              className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw className="size-3.5" aria-hidden="true" />
              )}
              Try again
            </button>
            <span className="text-xs text-muted-foreground">Retries every failed page of this file.</span>
            {retryError && <span className="text-xs font-medium text-destructive">{retryError}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/*
  The saved page picture: exactly what the image reader is (or was) sent.
  A plain <img>, not next/image: next/image would download the picture on
  the SERVER, without the student's login cookie, and get a 401.
  Click = full size in a new tab, to zoom into small screenshot text.
*/
function PagePicture({ src, page, onLoaded }: { src: string; page: number; onLoaded?: () => void }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  if (state === "error") {
    return (
      <p className="rounded-md border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
        The picture of this page couldn&apos;t be loaded.
      </p>
    );
  }
  return (
    <figure className="overflow-hidden rounded-md border bg-background">
      <a
        href={src}
        target="_blank"
        rel="noopener"
        className={cn(
          "relative block outline-none focus-visible:ring-2 focus-visible:ring-ring",
          state === "loading" && "min-h-48",
        )}
      >
        {state === "loading" && <span className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
        {/* eslint-disable-next-line @next/next/no-img-element -- see the comment above PagePicture */}
        <img
          src={src}
          alt={`Page ${page} of the PDF, as a picture`}
          onLoad={() => {
            setState("loaded");
            onLoaded?.();
          }}
          onError={() => setState("error")}
          className="relative block h-auto w-full"
        />
      </a>
      <figcaption className="flex items-center gap-2 border-t px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
        The page as a picture
        <a href={src} target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
          Full size <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

function describeVisuals(p: PageSummary): string {
  const parts: string[] = [];
  if (p.image_count) parts.push(p.image_count === 1 ? "a picture" : `${p.image_count} pictures`);
  if (p.drawing_count >= 3) parts.push("a diagram");
  if (p.math_symbol_count >= 3) parts.push("formulas");
  if (!parts.length) parts.push("content drawn as a picture");
  return parts.join(" and ");
}

function ChunkCard({
  chunk,
  position,
  total,
  focused = false,
  layoutKey,
}: {
  chunk: Chunk;
  position: number;
  total: number;
  focused?: boolean;
  /** changes when something above moved this card (the picture loaded) */
  layoutKey?: unknown;
}) {
  // The passage the student clicked in search: scroll it into view, and
  // again if the page picture above it finishes loading and pushes it down.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused, layoutKey]);

  return (
    <article
      ref={ref}
      className={cn("rounded-md border bg-background", focused && "border-primary ring-2 ring-primary/25")}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
        {chunk.chunk_type === "table" && <Table2 className="size-3.5" aria-hidden="true" />}
        {chunk.chunk_type === "diagram" && <Workflow className="size-3.5" aria-hidden="true" />}
        Passage {position} of {total}
        {chunk.chunk_type !== "text" && ` · ${chunk.chunk_type}`}
        {focused && (
          <span className="inline-flex items-center rounded-sm bg-primary px-1.5 py-px text-primary-foreground">
            From your search
          </span>
        )}
        {chunk.source === "vision" && (
          // The honest label: this text was written by the image reader, not copied from the PDF.
          // Dashed outline, not highlighter yellow: yellow is reserved for cited text.
          <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-primary/60 px-1.5 py-px text-primary">
            <ScanEye className="size-3" aria-hidden="true" />
            Read from an image — check it
          </span>
        )}
        <span className="ml-auto tabular-nums">~{chunk.token_count} tokens</span>
      </header>
      {chunk.chunk_type === "table" ? (
        <MarkdownTable content={chunk.content} />
      ) : (
        <div className="grid gap-2.5 px-3.5 py-3 font-serif text-[0.95rem] leading-relaxed">
          {splitFences(chunk.content).map((block, i) =>
            block.code !== null ? (
              // A screenshot of SQL / a terminal: exact characters, monospace,
              // line breaks and ASCII table borders kept; scrolls sideways if wide.
              <pre key={i} className="overflow-x-auto rounded-md bg-muted px-3 py-2.5 font-mono text-[0.8rem] leading-snug">
                {block.code}
              </pre>
            ) : (
              // Image-reader text keeps its line breaks (diagram lists, formulas
              // on their own line); text from the PDF flows as paragraphs.
              <p key={i} className={cn(chunk.source === "vision" && "whitespace-pre-line")}>
                {block.text}
              </p>
            ),
          )}
        </div>
      )}
    </article>
  );
}

/*
  Split text into paragraphs and ``` fenced code blocks (the image reader
  puts screenshots of code/terminals in fences). Stage 7's chat gets a full
  markdown renderer; this is enough for the viewer.
*/
export function splitFences(content: string): { text: string | null; code: string | null }[] {
  const out: { text: string | null; code: string | null }[] = [];
  const parts = content.split(/```[a-zA-Z]*\n?/);
  // split() alternates: outside fence, inside fence, outside, ...
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      if (part.trim()) out.push({ text: null, code: part.replace(/\n$/, "") });
    } else {
      for (const para of part.split("\n\n")) if (para.trim()) out.push({ text: para.trim(), code: null });
    }
  });
  return out;
}

/*
  Table chunks are stored as markdown:
      3.2 ACID properties            <- heading (optional)
      |Property|Meaning|Mechanism|   <- header row
      |---|---|---|                  <- separator
      |Atomicity|All or nothing|...|
  A tiny parser turns that into a real <table>. (The chat in Stage 7 gets a
  full markdown renderer; this is enough for tables.)
*/
export function MarkdownTable({ content }: { content: string }) {
  const lines = content.split("\n");
  const firstRow = lines.findIndex((l) => l.trim().startsWith("|"));
  const caption = lines.slice(0, Math.max(firstRow, 0)).join(" ").trim();
  const rows = lines
    .slice(firstRow)
    .filter((l) => l.trim().startsWith("|") && !/^\|?\s*:?-{2,}/.test(l.trim().replace(/^\|/, "")))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.replace(/<br>/g, " ").trim()));
  const [head, ...body] = rows;

  return (
    <div className="overflow-x-auto px-3.5 py-3">
      {caption && <p className="mb-2 text-sm font-bold">{caption}</p>}
      <table className="w-full border-collapse font-serif text-sm">
        <thead>
          <tr>
            {head?.map((cell, i) => (
              <th key={i} className="border bg-muted px-2.5 py-1.5 text-left font-sans font-bold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border px-2.5 py-1.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
