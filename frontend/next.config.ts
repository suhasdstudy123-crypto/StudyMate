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
  experimental: {
    /*
      Next.js reads at most 10 MB of a request body before forwarding it,
      and a bigger PDF upload was cut off (the browser saw a 500). 60 MB is
      a little above the backend's own 50 MB limit (MAX_UPLOAD_MB), so a
      too-big file still reaches FastAPI, which answers with a clear 413
      "This file is bigger than 50 MB." Keep the two numbers in step.
    */
    proxyClientMaxBodySize: "60mb",
  },
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
