"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";

/*
  Shown on /login and /register when you are ALREADY logged in.
  Before, those pages jumped straight to the dashboard, so there was no way
  to switch accounts or create a second one. Now you choose: carry on as
  yourself, or log out (POST /api/auth/logout deletes the cookie) and the
  normal form appears in place of this notice.
*/
export function SignedInNotice({ continueTo = "/dashboard" }: { continueTo?: string }) {
  const { user, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  async function onLogout() {
    setLeaving(true);
    try {
      await logout(); // status becomes "anonymous", so the page swaps this notice for the form
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4" role="status">
      <div>
        <p className="title-3">You&apos;re logged in as {user?.name}</p>
        <p className="mt-1 body-6 text-muted-foreground">
          {user?.email}. Log out first to use a different account or create a new one.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={continueTo}>Open dashboard</Link>
        </Button>
        <Button variant="outline" onClick={onLogout} disabled={leaving}>
          {leaving && <Loader2 className="animate-spin" aria-hidden="true" />}
          Log out
        </Button>
      </div>
    </div>
  );
}
