"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/*
  A modal dialog built on the browser's own <dialog> element.
  dialog.showModal() already gives us, for free:
    * a dimmed backdrop, and the rest of the page can't be clicked or tabbed to
    * Esc closes it (fires the "cancel" event)
    * focus moves into the dialog, and goes back to the button that opened it
  So we don't need a dialog library; this component only connects
  React's `open` prop to showModal()/close() and adds our styling.
  Put data-autofocus on the element that should get focus first.
*/
type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** While true (e.g. saving), Esc and backdrop clicks are ignored. */
  busy?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function Dialog({ open, onClose, title, description, busy = false, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descId = useId();

  // React state -> the real DOM element. Runs after every change of `open`.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React's autoFocus runs BEFORE this effect, while the dialog is still
      // hidden, so it can't focus anything. Instead, an element marked
      // data-autofocus gets focus here, right after the dialog is visible.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Esc: let the parent decide (it sets open=false), unless we're busy.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      // A click on the dimmed area hits the <dialog> itself (the inner panel
      // covers the rest). We also check where the press STARTED, so selecting
      // text inside and releasing outside doesn't close the dialog.
      onMouseDown={(e) => (pressedOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current && !busy) onClose();
      }}
      className={cn(
        "dialog-pop m-auto w-[calc(100%-2rem)] max-w-lg overflow-visible rounded-lg border bg-card p-0 text-card-foreground shadow-2xl",
        "backdrop:bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      {/* Only render the content while open, so each opening starts fresh. */}
      {open && (
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="absolute top-4 right-4 grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <h2 id={titleId} className="pr-8 text-xl font-extrabold tracking-tight">
            {title}
          </h2>
          {description && (
            <div id={descId} className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
