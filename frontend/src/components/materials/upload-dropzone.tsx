"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

import { MAX_UPLOAD_MB } from "@/lib/materials";
import { cn } from "@/lib/utils";

/*
  Where PDFs go in: drag files onto it, or click to pick them.

  Drag and drop is plain browser events:
    dragenter / dragover  -> a file is being held over the box (highlight it;
                             preventDefault() says "you may drop here")
    dragleave             -> it left again
    drop                  -> e.dataTransfer.files holds the dropped files
  Clicking opens a hidden <input type="file">, the normal file picker.

  The first check happens here (is it a PDF? under 50 MB?) so a wrong file
  is refused at once. The backend checks everything again: the browser
  can be fooled, the server can't.
*/
type Props = {
  onFiles: (accepted: File[], rejected: { name: string; reason: string }[]) => void;
  compact?: boolean;
};

export function UploadDropzone({ onFiles, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire when moving over CHILD elements; counting
  // them tells us when the pointer has really left the whole box.
  const depth = useRef(0);

  function handle(list: FileList | null) {
    if (!list?.length) return;
    const accepted: File[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of Array.from(list)) {
      const looksPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!looksPdf) rejected.push({ name: file.name, reason: "Only PDF files can be uploaded." });
      else if (file.size === 0) rejected.push({ name: file.name, reason: "This file is empty." });
      else if (file.size > MAX_UPLOAD_MB * 1024 * 1024)
        rejected.push({ name: file.name, reason: `This file is bigger than ${MAX_UPLOAD_MB} MB.` });
      else accepted.push(file);
    }
    onFiles(accepted, rejected);
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-lg border-2 border-dashed transition-colors",
        dragging ? "border-primary bg-primary/6" : "border-border bg-card hover:border-primary/50",
      )}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg text-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "px-6 py-6 sm:flex-row sm:gap-4" : "px-6 py-12",
        )}
      >
        <span
          className={cn(
            "grid place-items-center rounded-full bg-primary/10 text-primary transition-transform",
            compact ? "size-11" : "size-14",
            dragging && "scale-110",
          )}
          aria-hidden="true"
        >
          <FileUp className={compact ? "size-5" : "size-6"} />
        </span>
        <span className={cn("grid gap-1", compact && "sm:text-left")}>
          <span className="font-bold">
            {dragging ? "Drop to upload" : (
              <>
                Drop PDFs here or <span className="text-primary underline underline-offset-4">browse</span>
              </>
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            Lecture notes, slides, previous-year papers · up to {MAX_UPLOAD_MB} MB each
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = ""; // so picking the same file again still fires onChange
        }}
      />
    </div>
  );
}
