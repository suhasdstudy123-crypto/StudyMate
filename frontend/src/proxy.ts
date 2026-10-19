import { NextResponse, type NextRequest } from "next/server";

/*
  proxy.ts (called "middleware" before Next.js 16) runs on the server
  BEFORE a page is rendered. We use it for a quick, OPTIMISTIC check:

    no login cookie at all  ->  redirect to /login?next=<where you wanted to go>

  It only checks that the cookie EXISTS. It can't tell whether the token is
  valid or expired; only the backend can (it holds the secret). So this is a
  convenience that avoids flashing a protected page, not the security
  boundary. The real check is the backend answering 401, and the app
  layout then sends you to /login as well.
*/

const AUTH_COOKIE = "studymate_token"; // must match AUTH_COOKIE_NAME in backend/app/config.py

export function proxy(request: NextRequest) {
  if (!request.cookies.has(AUTH_COOKIE)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

// Only run on the logged-in part of the site
export const config = {
  matcher: ["/dashboard/:path*", "/courses/:path*", "/materials/:path*", "/chat/:path*"],
};
