import * as React from "react";

import { cn } from "@/lib/utils";

/* shadcn/ui-style text input, using our tokens. aria-invalid turns it red. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3.5 text-base text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
