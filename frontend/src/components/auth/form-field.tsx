"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/*
  One labelled form field with its error message underneath.
  aria-invalid + aria-describedby link the message to the input, so a
  screen reader reads "Email, invalid, Enter a valid email address".
*/
type FieldProps = React.ComponentProps<"input"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

export function FormField({ id, label, error, hint, ...inputProps }: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...inputProps} />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

/* Password field with a show/hide button. onVisibilityChange lets Marky
   react when you reveal the password. */
export function PasswordField({
  id,
  label,
  error,
  hint,
  onVisibilityChange,
  children,
  ...inputProps
}: FieldProps & { onVisibilityChange?: (visible: boolean) => void; children?: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  function toggle() {
    const next = !visible;
    setVisible(next);
    onVisibilityChange?.(next);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="pr-11"
          {...inputProps}
        />
        <button
          type="button"
          onClick={toggle}
          // onMouseDown preventDefault: keep focus in the input while clicking
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="text-sm font-medium text-destructive">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
    );
  }
  return null;
}
