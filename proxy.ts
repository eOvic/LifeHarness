// Guards the local server (Next 16 "proxy", formerly middleware). LifeHarness only ever serves
// this computer, and it holds your life map and AI credentials, so:
//  1. Host must be a loopback name. A web page can't reach us through a domain it controls
//     (DNS rebinding). LIFEHARNESS_ALLOW_HOSTS=host:port,… opts other names in, e.g. behind a tunnel.
//  2. Writes must come from our own pages: other sites can't forge requests (CSRF).
//  3. Desktop app: every request must carry the per-launch secret the Electron shell injects,
//     so other users and processes on the machine can't use the API either.
import { NextResponse, type NextRequest } from "next/server";

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const deny = (why: string) => new NextResponse(why, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });

// The page may talk to this server only: no remote images or fetches (so nothing the model writes
// can carry data out, e.g. via an image URL), no framing by other sites (clickjacking), no plugins.
// Next needs inline scripts/styles; dev mode also needs eval and its hot-reload websocket.
const dev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const extra = (process.env.LIFEHARNESS_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!LOOPBACK.test(host) && !extra.includes(host)) return deny("LifeHarness only answers requests from this computer.");

  const secret = process.env.LIFEHARNESS_API_SECRET;
  if (secret && req.nextUrl.pathname !== "/api/health" && req.headers.get("x-lifeharness-secret") !== secret) return deny("Forbidden.");

  if (!SAFE.has(req.method)) {
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return deny("Cross-site request blocked.");
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* "null" or garbage */
      }
      if (originHost !== host) return deny("Cross-origin request blocked.");
    }
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg).*)"],
};
