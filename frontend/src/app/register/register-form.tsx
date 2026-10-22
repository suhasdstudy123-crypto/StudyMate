"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { useAuth } from "@/components/auth/auth-provider";
import { FormField, PasswordField } from "@/components/auth/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import type { MascotMood } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Errors = { name?: string; email?: string; password?: string; form?: string };
type Focus = "name" | "email" | "password" | null;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Same limits as RegisterRequest in backend/app/schemas.py
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/* A rough strength score, only to guide the user. The backend's rule
   (8-128 characters) is the one that's enforced. */
function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < PASSWORD_MIN) return { score: 0, label: `At least ${PASSWORD_MIN} characters` };
  let points = 0;
  if (pw.length >= 12) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;
  if (points <= 1) return { score: 1, label: "Weak: try a longer password or mix in numbers" };
  if (points === 2) return { score: 2, label: "Good" };
  return { score: 3, label: "Strong" };
}

export function RegisterForm() {
  const router = useRouter();
  const { register, status, user } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [peeking, setPeeking] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    if (status === "authenticated" && !succeeded) router.replace("/dashboard");
  }, [status, succeeded, router]);

  const strength = passwordStrength(password);

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Enter your name.";
    else if (name.trim().length > 100) e.name = "Use 100 characters or fewer.";
    if (!email.trim()) e.email = "Enter your email address.";
    else if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address, like you@example.com.";
    if (password.length < PASSWORD_MIN) e.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX) e.password = `Use ${PASSWORD_MAX} characters or fewer.`;
    return e;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setShakeKey((k) => k + 1);
      return;
    }

    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password); // POST /api/auth/register
      setSucceeded(true);
      setTimeout(() => router.replace("/dashboard"), 900);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again.");
      if (apiErr.status === 409) {
        // users_email_unique said no: show it on the email field itself
        setErrors({ email: "An account with this email already exists." });
      } else {
        setErrors({ ...apiErr.fieldErrors, form: apiErr.message });
      }
      setShakeKey((k) => k + 1);
      setSubmitting(false);
    }
  }

  // ----- what Marky does -----
  const hasError = Boolean(errors.form || errors.name || errors.email || errors.password);
  let mood: MascotMood = "idle";
  let line = "Hi! I'm Marky. Let's get you set up.";
  if (succeeded) {
    mood = "wave";
    line = `Nice to meet you, ${user?.name.split(" ")[0] ?? "friend"}!`;
  } else if (submitting) {
    line = "Creating your account...";
  } else if (focus === "password") {
    mood = peeking ? "peek" : "shy";
    line = peeking
      ? "Okay, one tiny peek."
      : strength.score === 3
        ? "Strong one! Still not looking."
        : "Not looking. Promise.";
  } else if (hasError) {
    mood = "confused";
    line = errors.email?.includes("already exists")
      ? "That email already has an account."
      : "Almost! Check the red bits.";
  } else if (focus === "name") {
    line = name.trim() ? `Hi, ${name.trim().split(" ")[0]}!` : "What should I call you?";
  } else if (focus === "email") {
    line = "Go on, I'm reading along.";
  }
  const reading =
    !succeeded && focus === "name"
      ? Math.min(name.length / 20, 1)
      : !succeeded && focus === "email"
        ? Math.min(email.length / 28, 1)
        : null;

  const clearErrors = () => {
    if (hasError) setErrors({});
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, and it takes about a minute."
      mood={mood}
      reading={reading}
      line={line}
      shakeKey={shakeKey}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        {errors.form && <FormAlert>{errors.form}</FormAlert>}

        <FormField
          id="name"
          label="Name"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            clearErrors();
          }}
          onFocus={() => setFocus("name")}
          onBlur={() => setFocus(null)}
        />

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
            clearErrors();
          }}
          onFocus={() => setFocus("email")}
          onBlur={() => setFocus(null)}
        />

        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearErrors();
          }}
          onFocus={() => setFocus("password")}
          onBlur={() => setFocus(null)}
          onVisibilityChange={setPeeking}
        >
          {password && !errors.password && (
            <div aria-live="polite">
              <div className="flex gap-1.5" aria-hidden="true">
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={cn(
                      "h-1.5 flex-1 rounded-full bg-muted transition-colors duration-300",
                      strength.score >= level &&
                        (strength.score === 1 ? "bg-destructive" : strength.score === 2 ? "bg-highlight" : "bg-primary"),
                    )}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">{strength.label}</p>
            </div>
          )}
        </PasswordField>

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={submitting || succeeded}>
          {submitting || succeeded ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {succeeded ? "Account created" : submitting ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
