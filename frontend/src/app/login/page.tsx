import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

/*
  The page itself is a Server Component (it can export metadata).
  The interactive form is a Client Component in login-form.tsx.
  Suspense is required because the form reads ?next=... from the URL
  (useSearchParams), which is only known in the browser.
*/
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
