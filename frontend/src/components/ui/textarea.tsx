import * as React from "react";

import { cn } from "@/lib/utils";

/* Multi-line text box, styled exactly like Input. aria-invalid turns it red. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-card px-3 py-2 body-3 text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:body-6",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
