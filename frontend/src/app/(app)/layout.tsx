"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppHeader } from "@/components/app/app-header";
import { useAuth } from "@/components/auth/auth-provider";
import { Mascot } from "@/components/mascot";

/*
  Layout for every page inside the (app) folder: dashboard, courses,
  materials, chat. The folder name is in brackets, a "route group", so it
  groups files without appearing in the URL.

  This is the second guard (proxy.ts was the first):
    loading       -> we're asking the backend GET /auth/me
    anonymous     -> the backend said 401 (no cookie, expired or invalid
                     token) -> go to /login, then come back here after
    authenticated -> show the page with the app header
*/
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, signedOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // The ONLY place that sends you away from a private page. After a normal
  // "Log out" we go to plain /login; if the session simply wasn't valid,
  // we remember where you were (?next=) so login can bring you back.
  useEffect(() => {
    if (status !== "anonymous") return;
    router.replace(signedOut ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [status, signedOut, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4" role="status">
          <Mascot className="w-24" />
          <p className="font-semibold text-muted-foreground">Opening your notes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
