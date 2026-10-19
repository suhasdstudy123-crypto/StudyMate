"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { safeNextPath, useAuth } from "@/components/auth/auth-provider";
import { FormField, PasswordField } from "@/components/auth/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import type { MascotMood } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

type Errors = { email?: string; password?: string; form?: string };
type Focus = "email" | "password" | null;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // same rule as the users_email_format CHECK

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const { login, status, user } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [peeking, setPeeking] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Already logged in (e.g. opened /login in a new tab)? Go straight in.
  useEffect(() => {
    if (status === "authenticated" && !succeeded) router.replace(next);
  }, [status, succeeded, next, router]);

  // Check the form in the browser first, so obvious mistakes don't need
  // a trip to the server. The backend still validates everything again:
  // browser checks are for convenience, never for security.
  function validate(): Errors {
    const e: Errors = {};
    if (!email.trim()) e.email = "Enter your email address.";
    else if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address, like you@example.com.";
    if (!password) e.password = "Enter your password.";
    return e;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); // stop the browser's default full-page form submit
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setShakeKey((k) => k + 1);
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password); // POST /api/auth/login -> FastAPI
      setSucceeded(true);
      // A short pause so you see Marky celebrate, then go to the page you wanted
      setTimeout(() => router.replace(next), 700);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again.");
      setErrors({ ...apiErr.fieldErrors, form: apiErr.message });
      setPassword(""); // clear the wrong password, keep the email
      setShakeKey((k) => k + 1);
      setSubmitting(false);
    }
  }

  // ----- what Marky does -----
  const hasError = Boolean(errors.form || errors.email || errors.password);
  let mood: MascotMood = "idle";
  let line = "Welcome back! Your notes missed you.";
  if (succeeded) {
    mood = "wave";
    line = `Welcome back, ${user?.name.split(" ")[0] ?? "friend"}!`;
  } else if (submitting) {
    line = "Checking your details...";
  } else if (focus === "password") {
    mood = peeking ? "peek" : "shy";
    line = peeking ? "Okay, one tiny peek." : "Not looking. Promise.";
  } else if (hasError) {
    mood = "confused";
    line = errors.form?.startsWith("Couldn't reach") ? "I can't reach the server right now." : "Hmm, that didn't work. Try again?";
  } else if (focus === "email") {
    line = "Go on, I'm reading along.";
  }
  const reading = focus === "email" && !succeeded ? Math.min(email.length / 28, 1) : null;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to ask your notes."
      mood={mood}
      reading={reading}
      line={line}
      shakeKey={shakeKey}
      footer={
        <>
          New to StudyMate?{" "}
          <Link href="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {/* noValidate: we show our own messages instead of the browser's popups */}
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        {errors.form && !errors.email && !errors.password && <FormAlert>{errors.form}</FormAlert>}

        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (hasError) setErrors({});
          }}
          onFocus={() => setFocus("email")}
          onBlur={() => setFocus(null)}
        />

        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (hasError) setErrors({});
          }}
          onFocus={() => setFocus("password")}
          onBlur={() => setFocus(null)}
          onVisibilityChange={setPeeking}
        />

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={submitting || succeeded}>
          {submitting || succeeded ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {succeeded ? "Logged in" : submitting ? "Logging in" : "Log in"}
        </Button>
      </form>
    </AuthShell>
  );
}
