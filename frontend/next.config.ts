import type { NextConfig } from "next";

/*
  Where the FastAPI backend runs. Read from an environment variable so
  production can point somewhere else; defaults to the local dev server.
  127.0.0.1, not "localhost": Node may resolve "localhost" to the IPv6
  address ::1 first, but uvicorn listens on IPv4 127.0.0.1 only, which
  gives a confusing "connection refused".
*/
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  /*
    Rewrites = Next.js acting as a forwarder (a "reverse proxy"):
      browser -> localhost:3000/api/auth/login
      Next.js -> 127.0.0.1:8001/auth/login  (and passes the answer back)
    The browser only ever talks to ONE origin (localhost:3000), so:
      * the login cookie belongs to the website itself and is sent back
        automatically on every /api request;
      * no CORS setup is needed, because nothing is cross-origin.
  */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
