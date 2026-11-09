import * as React from "react";

import { cn } from "@/lib/utils";

/* shadcn/ui-style text input, using our tokens. aria-invalid turns it red. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 body-3 text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:body-6",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
