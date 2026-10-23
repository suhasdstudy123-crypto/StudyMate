"use client";

import { useEffect, useState } from "react";
import { ImageOff, Loader2, Table2 } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { getPage, listPages, type Chunk, type Material, type PageDetail, type PageSummary } from "@/lib/materials";
import { cn } from "@/lib/utils";

/*
  "What StudyMate read": the file page by page, exactly as it is stored.

    left:  every page, with markers for tables and for pages that have
           pictures the text reader can't see
    right: the passages (chunks) of the selected page, in order

  This is the same text that search (Stage 6) and the chat (Stage 7) will
  use, so it's the place to check that a PDF was read correctly.
  Text from your notes is shown in the serif font, the app's rule for
  "this came from your documents".
*/
type Props = { material: Material | null; onClose: () => void };

export function PagesDialog({ material, onClose }: Props) {
  return (
    <Dialog
      open={material !== null}
      onClose={onClose}
      title="What StudyMate read"
      description={material ? <span className="font-semibold text-foreground">{material.title}</span> : null}
      className="max-w-5xl"
    >
      {material && <Viewer key={material.id} material={material} />}
    </Dialog>
  );
}

function Viewer({ material }: { material: Material }) {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [current, setCurrent] = useState(1);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The page list: once, when the viewer opens.
  useEffect(() => {
    let alive = true;
    listPages(material.id)
      .then((list) => alive && setPages(list))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Couldn't load the pages."));
    return () => {
      alive = false;
    };
  }, [material.id]);

  // The selected page's passages: every time another page is picked.
  useEffect(() => {
    let alive = true;
    getPage(material.id, current)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Couldn't load this page."));
    return () => {
      alive = false;
    };
  }, [material.id, current]);

  const loading = detail?.page.page_number !== current;

  return (
    // minmax(0, 1fr): the long strip of page buttons must not widen the grid (phones)
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
      {/* Page list: a column on wide screens, a scrolling strip on phones */}
      <nav aria-label="Pages" className="-mx-1 md:mx-0">
        <ol className="flex gap-1.5 overflow-x-auto px-1 pb-2 md:max-h-[60vh] md:flex-col md:overflow-y-auto md:pr-2 md:pb-0">
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
                  {p.needs_vision && <ImageOff className="size-3.5" aria-label="has pictures" />}
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
          <PageView detail={detail} />
        )}
      </section>
    </div>
  );
}

function PageView({ detail }: { detail: PageDetail }) {
  const { page, chunks } = detail;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Page {page.page_number} · {chunks.length} {chunks.length === 1 ? "passage" : "passages"}
        {page.table_count > 0 && ` · ${page.table_count} ${page.table_count === 1 ? "table" : "tables"}`}
      </p>

      {page.needs_vision && (
        <div className="flex items-start gap-2.5 rounded-md border border-dashed bg-muted/60 px-3.5 py-3 text-sm">
          <ImageOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-semibold">This page has {describeVisuals(page)}.</span>{" "}
            <span className="text-muted-foreground">
              Text extraction can&apos;t see inside pictures, so only the text around them is below. The image reader
              (coming soon) will read the rest.
            </span>
          </p>
        </div>
      )}

      {chunks.length === 0 ? (
        <p className="rounded-md border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          No text on this page.
        </p>
      ) : (
        // Numbered within this page ("Passage 2 of 3"), not by the file-wide
        // chunk_index, which reads oddly on page 26 ("Passage 31").
        chunks.map((chunk, i) => <ChunkCard key={chunk.id} chunk={chunk} position={i + 1} total={chunks.length} />)
      )}
    </div>
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

function ChunkCard({ chunk, position, total }: { chunk: Chunk; position: number; total: number }) {
  return (
    <article className="rounded-md border bg-background">
      <header className="flex items-center gap-2 border-b px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
        {chunk.chunk_type === "table" ? <Table2 className="size-3.5" aria-hidden="true" /> : null}
        Passage {position} of {total}
        {chunk.chunk_type === "table" && " · table"}
        <span className="ml-auto tabular-nums">~{chunk.token_count} tokens</span>
      </header>
      {chunk.chunk_type === "table" ? (
        <MarkdownTable content={chunk.content} />
      ) : (
        <div className="grid gap-2.5 px-3.5 py-3 font-serif text-[0.95rem] leading-relaxed">
          {chunk.content.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
    </article>
  );
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
function MarkdownTable({ content }: { content: string }) {
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
