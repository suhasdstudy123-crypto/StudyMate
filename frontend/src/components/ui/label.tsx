import * as React from "react";

import { cn } from "@/lib/utils";

/* A <label> tied to an input with htmlFor: clicking it focuses the input,
   and screen readers announce the label when the input is focused. */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-semibold leading-none", className)} {...props} />;
}

export { Label };
