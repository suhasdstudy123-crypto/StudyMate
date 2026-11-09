"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { MAX_QUESTION_CHARS } from "@/lib/chat";
import { cn } from "@/lib/utils";

/*
  The question box. Enter sends, Shift+Enter makes a new line (like every
  chat app). It grows with the text up to ~6 lines, then scrolls.
  While an answer streams, the send button becomes Stop.
*/

type Props = {
  onSend: (question: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** shown instead of the hint: a problem ("error") or just good to know ("info") */
  notice?: string | null;
  noticeTone?: "error" | "info";
  placeholder: string;
  /** set from outside (a suggestion chip); `nonce` re-applies the same text */
  preset?: { text: string; nonce: number } | null;
};

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled = false,
  notice,
  noticeTone = "error",
  placeholder,
  preset,
}: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content: reset the height, then set it to what's needed.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // A suggestion chip fills the box and focuses it (the student can still edit).
  const presetNonce = preset?.nonce;
  const presetText = preset?.text;
  useEffect(() => {
    if (presetText === undefined) return;
    ref.current?.focus();
  }, [presetNonce, presetText]);
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (preset && preset.nonce !== appliedNonce) {
    // Adjusting state while rendering (React's recommended pattern instead of an effect)
    setAppliedNonce(preset.nonce);
    setText(preset.text);
  }

  const question = text.trim();
  const tooLong = text.length > MAX_QUESTION_CHARS;
  const canSend = !streaming && !disabled && question.length > 0 && !tooLong;

  function submit() {
    if (!canSend) return;
    onSend(question);
    setText("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-2"
    >
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border bg-card p-2 pl-3 shadow-sm transition-[border-color,box-shadow]",
          "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
          tooLong && "border-destructive",
        )}
      >
        <label htmlFor="chat-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="chat-question"
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // isComposing: don't send while typing with an input method (e.g. Hindi/Japanese keyboards)
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={tooLong || undefined}
          className="max-h-42 min-h-10 flex-1 resize-none bg-transparent py-2 body-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop the answer"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-[transform,opacity] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Ask"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-[transform,opacity,background-color] outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p
        className={cn(
          "px-3 caption-5",
          notice && noticeTone === "error" && "caption-4 text-destructive",
          notice && noticeTone === "info" && "caption-4 text-foreground",
          !notice && "text-muted-foreground",
        )}
      >
        {notice ??
          (tooLong
            ? `That's ${text.length} characters; questions can be up to ${MAX_QUESTION_CHARS}.`
            : "Answers come only from your notes, with page citations. Enter to ask, Shift+Enter for a new line.")}
      </p>
    </form>
  );
}
