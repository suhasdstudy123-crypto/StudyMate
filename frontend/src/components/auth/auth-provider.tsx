"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, type User } from "@/lib/api";

/*
  Auth state shared by the whole website (React Context).
  Any component can call useAuth() to know who is logged in, or to
  log in / register / log out, without passing props through every level.

  Where is the login actually stored? NOT here. The real proof of login is
  the httpOnly cookie the backend set, which JavaScript can't read. This
  provider only remembers "who the backend says I am" (from GET /auth/me)
  so the UI can show your name.
*/

type Status = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: Status;
  /** true right after the user clicked "Log out" (vs. a session that expired) */
  signedOut: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthResponse = { access_token: string; token_type: string; user: User };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [signedOut, setSignedOut] = useState(false);

  // On first load, ask the backend "who am I?". The browser sends the
  // cookie automatically. 200 = logged in, 401 = not logged in.
  useEffect(() => {
    let cancelled = false;
    api<User>("/auth/me")
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // The backend sets the cookie in its response; we only keep the user.
    // (The access_token in the body is for API clients; we ignore it.)
    const res = await api<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
    setUser(res.user);
    setStatus("authenticated");
    setSignedOut(false);
    return res.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api<AuthResponse>("/auth/register", { method: "POST", body: { name, email, password } });
    setUser(res.user);
    setStatus("authenticated");
    setSignedOut(false);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<void>("/auth/logout", { method: "POST" }); // backend deletes the cookie
    } finally {
      setUser(null);
      setSignedOut(true);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, signedOut, login, register, logout }),
    [user, status, signedOut, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/*
  Where to go after logging in. Only accept paths on OUR site ("/courses"),
  never "//evil.com" or "https://evil.com": otherwise a link like
  /login?next=https://evil.com would send students to a fake site
  right after they log in (an "open redirect").
*/
export function safeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  return "/dashboard";
}
