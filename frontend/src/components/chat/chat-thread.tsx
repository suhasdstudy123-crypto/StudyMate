"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Library, RotateCw, Search, SearchX, Square } from "lucide-react";

import { AnswerMarkdown } from "@/components/chat/answer-markdown";
import { Button } from "@/components/ui/button";
import { modelLabel, type ChatMessage, type ErrorEvent } from "@/lib/chat";
import { cn } from "@/lib/utils";

/*
  The conversation: the student's questions (right, in ink) and StudyMate's
  answers (left, on paper). An answer goes through visible phases while it
  streams, so the student always knows what is happening:

    searching -> "Searching your notes…"      (follow-up rewrite + hybrid search)
    reading   -> "Reading 8 passages…"         (sources arrived, model is thinking)
    writing   -> text appears with a caret     (delta events)
    done      -> citations, sources, model name
*/

export type Phase = "searching" | "reading" | "writing";

/** A message on screen: a saved one, or one being streamed right now. */
export type UiMessage = ChatMessage & {
  phase?: Phase;
  error?: ErrorEvent & { question: string };
};

type Props = {
  messages: UiMessage[];
  selectedId: string | null;
  activeN: number | null;
  onCite: (messageId: string, n: number) => void;
  onSelect: (messageId: string) => void;
  onRetry: (question: string, failedId: string) => void;
  /** phones/tablets: open the sources of this answer in a dialog */
  onShowSources: (messageId: string) => void;
};

export function ChatThread({ messages, selectedId, activeN, onCite, onSelect, onRetry, onShowSources }: Props) {
  return (
    <ol className="grid grid-cols-1 gap-6" aria-label="Conversation">
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.li
            key={m.id}
            layout="position"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            // Keep this short: when a streamed answer gets its saved id, the old copy
            // fades out while the new one fades in; a long fade leaves both on screen.
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {m.role === "user" ? (
              <Question message={m} />
            ) : (
              <Answer
                message={m}
                selected={m.id === selectedId}
                activeN={m.id === selectedId ? activeN : null}
                onCite={(n) => onCite(m.id, n)}
                onSelect={() => onSelect(m.id)}
                onRetry={onRetry}
                onShowSources={() => onShowSources(m.id)}
              />
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function Question({ message }: { message: UiMessage }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-muted px-4 py-2 body-3">
        {message.content}
      </p>
      {message.search_query && (
        // Follow-ups are rewritten before searching: show what was searched, honestly.
        <p className="flex max-w-[85%] items-center gap-1 caption-5 text-muted-foreground">
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Searched your notes for <span className="caption-4 text-foreground">“{message.search_query}”</span>
          </span>
        </p>
      )}
    </div>
  );
}

function Answer({
  message,
  selected,
  activeN,
  onCite,
  onSelect,
  onRetry,
  onShowSources,
}: {
  message: UiMessage;
  selected: boolean;
  activeN: number | null;
  onCite: (n: number) => void;
  onSelect: () => void;
  onRetry: (question: string, failedId: string) => void;
  onShowSources: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const streaming = message.phase !== undefined;
  const notInNotes = message.status === "not_in_notes";
  const citedCount = message.sources.filter((s) => s.cited).length;

  if (message.error) {
    const e = message.error;
    const when = e.available_at
      ? new Date(e.available_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : null;
    return (
      <div role="alert" className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="grid gap-2">
          <p className="body-2">{e.message}</p>
          {when && <p className="body-6 text-muted-foreground">Answers work again at {when}.</p>}
          {e.reason !== "setup" && (
            <Button variant="outline" size="sm" className="w-fit" onClick={() => onRetry(e.question, message.id)}>
              <RotateCw aria-hidden="true" /> Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <div className="flex">
      <div
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-300",
          // the answer whose sources are showing on the right gets a darker edge
          selected && !streaming && "xl:border-foreground/30 xl:shadow-sm",
          notInNotes && "border-dashed",
        )}
      >
        {notInNotes && (
          <p className="mb-2 flex items-center gap-2 title-4">
            <SearchX className="size-4 text-muted-foreground" aria-hidden="true" />
            Not in your notes
          </p>
        )}

        {/* Before the first words arrive: what's happening right now */}
        {streaming && message.content === "" && <Thinking phase={message.phase!} passages={message.sources.length} />}

        {message.content !== "" && (
          <div className={cn(streaming && "streaming-answer")}>
            <AnswerMarkdown text={message.content} sources={message.sources} activeN={activeN} onCite={onCite} />
          </div>
        )}

        {message.status === "stopped" && (
          <p className="mt-2 inline-flex items-center gap-1 caption-4 text-muted-foreground">
            <Square className="size-3" aria-hidden="true" /> Stopped: this answer is incomplete
          </p>
        )}

        {!streaming && (
          <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 caption-5 text-muted-foreground">
            {message.sources.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                  onShowSources();
                }}
                className="inline-flex items-center gap-1 rounded-sm caption-4 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring xl:pointer-events-none xl:text-foreground"
              >
                <Library className="size-3.5" aria-hidden="true" />
                {citedCount > 0
                  ? `${citedCount} of ${message.sources.length} ${message.sources.length === 1 ? "passage" : "passages"} cited`
                  : `${message.sources.length} ${message.sources.length === 1 ? "passage" : "passages"} checked`}
              </button>
            )}
            {message.model && <span>Answered by {modelLabel(message.model)}</span>}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void copy();
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Copy answer"
            >
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function Thinking({ phase, passages }: { phase: Phase; passages: number }) {
  const label =
    phase === "searching"
      ? "Searching your notes"
      : passages > 0
        ? `Reading ${passages} ${passages === 1 ? "passage" : "passages"}`
        : "Checking your notes";
  return (
    <div className="flex items-center gap-3" role="status">
      {/* a small dot that breathes while StudyMate works */}
      <span aria-hidden="true" className="skeleton size-2 shrink-0 rounded-full bg-muted-foreground!" />
      <AnimatePresence mode="wait">
        <motion.p
          key={label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="body-5 text-muted-foreground"
        >
          {label}
          <span className="thinking-dots" aria-hidden="true" />
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
