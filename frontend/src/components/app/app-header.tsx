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
          "relative rounded-md px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {item.label}
        {/* the active page gets a highlighter stroke underneath */}
        {active && <span aria-hidden="true" className="absolute inset-x-3 -bottom-0.5 h-1 rounded-full bg-highlight" />}
      </Link>
    );
  });

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3 sm:px-8">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {navLinks}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="flex items-center gap-2.5 rounded-full border bg-card py-1 pl-1 pr-3">
            <span
              className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:inline">{user?.name}</span>
            {user?.role === "admin" && (
              <span className="rounded-full bg-highlight px-2 py-0.5 text-xs font-bold text-highlight-foreground">
                Admin
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} disabled={leaving} aria-label="Log out">
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </div>

      {/* phones: the nav links move to their own row */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Main">
        {navLinks}
      </nav>
    </header>
  );
}
