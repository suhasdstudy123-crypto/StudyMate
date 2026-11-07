"use client";

import {
  AlertTriangle,
  BookOpenText,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  PauseCircle,
  Pencil,
  RotateCw,
  ScanEye,
  Trash2,
  X,
} from "lucide-react";
import { motion } from "motion/react";

import { timeAgo } from "@/lib/courses";
import { fileUrl, formatBytes, isWorking, type Material, type ReaderStatus } from "@/lib/materials";
import { cn } from "@/lib/utils";

/*
  One file in a course, in whichever state it's in:

    uploading   bytes still travelling from the browser (local only, no row yet)
    pending     stored; waiting for a free background worker  ("Queued")
    processing  a worker is reading it        ("Reading page 12 of 41")
    ready       searchable: page / chunk / table counts
                + the image reader's progress on picture pages (Stage 5b)
    failed      the reason, and a Retry button

  The numbers come from the material_overview view (backend).
*/

// ---------- a file that is still uploading (exists only in the browser) ----------

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number; // 0..1
  error: string | null;
  abort: () => void;
};

export function UploadRow({ item, onDismiss }: { item: UploadItem; onDismiss: () => void }) {
  const pct = Math.round(item.progress * 100);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn("rounded-lg border bg-card p-4", item.error && "border-destructive/40")}
    >
      <div className="flex items-center gap-3">
        <FileIcon tone={item.error ? "error" : "working"} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{item.name}</p>
          {item.error ? (
            <p className="mt-0.5 text-sm font-medium text-destructive">{item.error}</p>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Uploading {pct}% · {formatBytes(item.size)}
            </p>
          )}
        </div>
        <IconAction
          label={item.error ? `Dismiss ${item.name}` : `Cancel upload of ${item.name}`}
          onClick={item.error ? onDismiss : item.abort}
        >
          <X />
        </IconAction>
      </div>
      {!item.error && <Progress value={item.progress} />}
    </motion.li>
  );
}

// ---------- a stored file ----------

type Props = {
  material: Material;
  reader: ReaderStatus | null;
  onView: (m: Material) => void;
  onRename: (m: Material) => void;
  onRetry: (m: Material) => void;
  onRetryPages: (m: Material) => void;
  onDelete: (m: Material) => void;
};

export function MaterialRow({ material: m, reader, onView, onRename, onRetry, onRetryPages, onDelete }: Props) {
  const working = isWorking(m);
  const pages = m.page_count ?? 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      className={cn("group rounded-lg border bg-card p-4 transition-colors", m.status === "failed" && "border-destructive/40")}
    >
      {/* flex-wrap: on phones the actions wrap onto their own line under the
          details (all 4 are always visible there, there's no hover) */}
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <FileIcon tone={m.status === "failed" ? "error" : working ? "working" : "ready"} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="min-w-0 truncate font-bold" title={m.original_filename}>
              {m.title}
            </h3>
            <StatusChip material={m} />
          </div>

          {/* Second line: what we know about the file */}
          <p className="mt-1 text-sm text-muted-foreground">
            {m.status === "ready" ? (
              <>
                {pages} {pages === 1 ? "page" : "pages"} · {m.chunk_count} {m.chunk_count === 1 ? "passage" : "passages"}
                {m.table_count > 0 && ` · ${m.table_count} ${m.table_count === 1 ? "table" : "tables"}`}
                {m.processing_mode === "thorough" && " · Thorough"} · {formatBytes(m.file_size)} · added{" "}
                {timeAgo(m.created_at)}
              </>
            ) : m.status === "failed" ? (
              <span className="font-medium text-destructive">{m.error_message}</span>
            ) : m.status === "processing" ? (
              <>
                Reading page {Math.min(m.pages_processed + 1, pages)} of {pages}
              </>
            ) : (
              <>Waiting for its turn · {pages} {pages === 1 ? "page" : "pages"}</>
            )}
          </p>

          {m.status === "ready" && <PictureReading material={m} reader={reader} onRetryPages={() => onRetryPages(m)} />}
        </div>

        {/* Actions: always visible on touch, on hover/focus with a mouse */}
        <div className="-mb-1 flex w-full shrink-0 items-center gap-0.5 pl-[2.75rem] sm:-mt-1 sm:-mr-1 sm:mb-0 sm:w-auto sm:pl-0">
          {m.status === "ready" && (
            <IconAction label={`See what StudyMate read in ${m.title}`} onClick={() => onView(m)} emphasis>
              <BookOpenText />
            </IconAction>
          )}
          {m.status === "failed" && (
            <IconAction label={`Try reading ${m.title} again`} onClick={() => onRetry(m)} emphasis>
              <RotateCw />
            </IconAction>
          )}
          <div className="flex items-center gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
            <a
              href={fileUrl(m.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${m.title} (PDF, new tab)`}
              title="Open PDF"
              className="grid size-9 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
            >
              <ExternalLink />
            </a>
            <IconAction label={`Rename ${m.title}`} onClick={() => onRename(m)}>
              <Pencil />
            </IconAction>
            <IconAction
              label={m.status === "processing" ? "Can't delete while it's being read" : `Delete ${m.title}`}
              onClick={() => onDelete(m)}
              disabled={m.status === "processing"}
              danger
            >
              <Trash2 />
            </IconAction>
          </div>
        </div>
      </div>

      {working && <Progress value={m.status === "processing" && pages ? m.pages_processed / pages : 0} indeterminate={m.status === "pending"} />}
    </motion.li>
  );
}

// ---------- the image reader's progress on this file's picture pages ----------

/*
  Honest about every state, because the student is waiting on it:
    reading   "Reading pictures · 7 of 19 pages" + bar
    paused    daily limit used up, or Google overloaded: says why and when it continues
    off/error the server can't read pictures right now (not their file's fault)
    failed    "2 pages couldn't be read" + Try again
    done      "19 pages read from pictures"
*/
function PictureReading({
  material: m,
  reader,
  onRetryPages,
}: {
  material: Material;
  reader: ReaderStatus | null;
  onRetryPages: () => void;
}) {
  const total = m.vision_waiting_count + m.vision_done_count + m.vision_failed_count;
  if (total === 0) return null;
  const note = "mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md px-2.5 py-1.5 text-xs font-medium";

  if (m.vision_waiting_count > 0) {
    const stopped = reader && reader.status !== "ok";
    return (
      <div className="mt-2 grid max-w-md gap-1.5">
        {/* flex-nowrap + items-start: a long message wraps NEXT TO its icon, not under it */}
        <p className={cn(note, "mt-0 flex-nowrap items-start bg-muted", stopped ? "text-foreground" : "text-muted-foreground")}>
          {stopped ? (
            <PauseCircle className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Loader2 className="mt-px size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          )}
          {stopped ? (
            <span className="min-w-0">
              {reader.status === "paused" ? (
                // The server says why: daily limit used up, or Google overloaded
                <>
                  Reading pictures paused. {reader.message} Continues at{" "}
                  <strong>{formatTime(reader.paused_until)}</strong>.
                </>
              ) : (
                reader.message
              )}{" "}
              {m.vision_done_count} of {total} picture pages read so far; the rest of the text is searchable.
            </span>
          ) : (
            <span>
              Reading pictures · {m.vision_done_count} of {total} {total === 1 ? "page" : "pages"}
            </span>
          )}
        </p>
        {!stopped && <Progress value={m.vision_done_count / total} className="mt-0" />}
      </div>
    );
  }

  if (m.vision_failed_count > 0) {
    return (
      <p className={cn(note, "bg-destructive/8 text-foreground")}>
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        {m.vision_failed_count} {m.vision_failed_count === 1 ? "page" : "pages"} couldn&apos;t be read from{" "}
        {m.vision_failed_count === 1 ? "its picture" : "their pictures"}.
        <button
          type="button"
          onClick={onRetryPages}
          className="ml-1 inline-flex items-center gap-1 rounded-sm font-bold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="size-3" aria-hidden="true" /> Try again
        </button>
      </p>
    );
  }

  return (
    <p className={cn(note, "w-fit bg-primary/8 text-primary")}>
      <ScanEye className="size-3.5 shrink-0" aria-hidden="true" />
      {m.vision_done_count} {m.vision_done_count === 1 ? "page" : "pages"} read from pictures
    </p>
  );
}

/** "12:30 PM" in the student's own time zone (the server sends UTC). */
function formatTime(iso: string | null): string {
  if (!iso) return "the daily reset";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// ---------- small pieces ----------

function StatusChip({ material: m }: { material: Material }) {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold";
  switch (m.status) {
    case "ready":
      return (
        <span className={cn(base, "bg-primary/10 text-primary")}>
          <Check className="size-3" aria-hidden="true" /> Ready
        </span>
      );
    case "processing":
      return (
        <span className={cn(base, "bg-muted text-foreground")}>
          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Reading
        </span>
      );
    case "pending":
      return (
        <span className={cn(base, "bg-muted text-muted-foreground")}>
          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Queued
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-destructive/10 text-destructive")}>
          <AlertTriangle className="size-3" aria-hidden="true" /> Failed
        </span>
      );
  }
}

function FileIcon({ tone }: { tone: "ready" | "working" | "error" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-md",
        tone === "ready" && "bg-primary text-primary-foreground",
        tone === "working" && "bg-muted text-primary",
        tone === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      <FileText className="size-5" />
    </span>
  );
}

function Progress({
  value,
  indeterminate = false,
  className,
}: {
  value: number;
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("mt-3 h-1.5 overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
    >
      {indeterminate ? (
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-primary/60" />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(3, value * 100)}%` }}
        />
      )}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
  danger = false,
  emphasis = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  emphasis?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "grid size-9 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
        emphasis ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        danger && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
