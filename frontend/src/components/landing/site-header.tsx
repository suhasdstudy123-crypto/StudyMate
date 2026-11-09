"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { status } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
          <ThemeToggle />
          {status === "authenticated" ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
