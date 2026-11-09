"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/courses", label: "Courses" },
  { href: "/chat", label: "Ask" },
];

export function AppHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  async function onLogout() {
    setLeaving(true);
    // POST /api/auth/logout: the backend deletes the cookie. The (app)
    // layout then notices you're logged out and takes you to /login.
    await logout();
  }

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const navLinks = NAV.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "rounded-lg px-3 py-2 title-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // the current page: filled and darker, so "where am I" is obvious without decoration
          active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-8">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {navLinks}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="flex items-center gap-2 px-1">
            <span
              className="grid size-8 place-items-center rounded-full bg-muted caption-3 text-foreground"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="hidden flex-col sm:flex">
              <span className="max-w-40 truncate title-4">{user?.name}</span>
              {user?.role === "admin" && <span className="caption-5 text-muted-foreground">Admin</span>}
            </span>
            {user?.role === "admin" && <span className="caption-5 text-muted-foreground sm:hidden">Admin</span>}
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} disabled={leaving} aria-label="Log out">
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </div>

      {/* phones: the nav links move to their own row */}
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden" aria-label="Main">
        {navLinks}
      </nav>
    </header>
  );
}
