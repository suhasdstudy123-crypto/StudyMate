import { CircleAlert } from "lucide-react";

/* A message about the whole form (not one field), e.g. "Invalid email or
   password". role="alert" makes screen readers announce it immediately. */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 body-5"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
