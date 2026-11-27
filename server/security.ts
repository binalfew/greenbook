import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { extractViolationContext, logRateLimitViolation } from "./rate-limit-audit.js";

// ─── CORS ──────────────────────────────────────────────────
// CORS_ORIGINS is comma-separated. Credentials are enabled so cookie auth
// works across subdomains; apps that lock to a single origin should narrow
// this list in production.
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const corsMiddleware = cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "X-CSRF-Token",
    "If-Match",
    "Idempotency-Key",
    "X-Correlation-Id",
    "X-Request-Id",
  ],
});

// ─── Cross-site request forgery ────────────────────────────
// Most route actions never call `validateCSRF`, and the session cookie's
// `sameSite: lax` is the only thing between them and a forged form post. This
// closes the gap for every route at once: a state-changing request must come
// from a page on this site. Browsers attach `Origin` to every cross-origin
// write and scripts cannot forge it, so a mismatch is a forged request.
// Requests with neither header come from non-browser clients, which carry no
// ambient cookies to abuse.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The SAML identity provider posts the assertion here from its own origin.
const CROSS_ORIGIN_POST_PATHS = new Set(["/sso/callback"]);

function trustedOrigins(): Set<string> {
  const configured = [process.env.APP_URL, ...allowedOrigins].filter(Boolean) as string[];
  const origins = new Set<string>();
  for (const value of configured) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore a malformed entry rather than refuse every write.
    }
  }
  return origins;
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || CROSS_ORIGIN_POST_PATHS.has(req.path)) return next();

  const origin = req.get("origin");
  let allowed: boolean;
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" (sandboxed iframe, data: URL) or garbage — never same-origin.
    }
    allowed =
      (originHost !== null && originHost === req.get("host")) || trustedOrigins().has(origin);
  } else {
    const site = req.get("sec-fetch-site");
    allowed = !site || site === "same-origin" || site === "none";
  }

  if (allowed) return next();
  res.status(403).json({ error: "FORBIDDEN", message: "Cross-site request refused." });
}

// ─── Session extraction for rate-limit keying ──────────────
// Looks up the cookie-stored session id and stores it in res.locals so
// createKeyGenerator keys per-user when authenticated, falling back to IP.
export function extractSessionUser(
  getSessionFn: (request: globalThis.Request) => Promise<{ get(key: string): unknown }>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookie = req.headers.cookie || "";
      const fakeReq = new globalThis.Request("http://localhost", {
        headers: { Cookie: cookie },
      });
      const session = await getSessionFn(fakeReq);
      const sessionId = session.get("sessionId");
      if (sessionId && typeof sessionId === "string") {
        res.locals.userId = sessionId;
      }
    } catch {
      // Silently fail — unauthenticated users fall back to IP-based limiting.
    }
    next();
  };
}

// ─── Rate Limiting ─────────────────────────────────────────

export function createKeyGenerator() {
  return (req: Request, res: Response): string => {
    const userId = res.locals.userId as string | undefined;
    if (userId) return `user:${userId}`;
    return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
  };
}

export function skipHealthCheck(req: Request): boolean {
  return req.path === "/up" || req.path === "/healthz";
}

export function createRateLimitHandler(tier: string, limit: number) {
  return (req: Request, res: Response) => {
    const retryAfter = Math.ceil(Number(res.getHeader("Retry-After")) || 60);
    res.status(429).json({
      error: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
      retryAfter,
      limit,
      tier,
    });
    logRateLimitViolation(extractViolationContext(req, res, tier, limit));
  };
}

// 15-minute window, 300 requests (per-user if logged in, per-IP otherwise).
// Tune via env when apps have different throughput profiles.
export const generalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900_000,
  limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(),
  skip: skipHealthCheck,
  handler: createRateLimitHandler("general", Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300),
  validate: { keyGeneratorIpFallback: false },
});

// 1-minute window, 50 mutations — curbs write-heavy abuse without
// interfering with normal browsing (GET/HEAD/OPTIONS skipped).
export const mutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(),
  skip: (req: Request) =>
    skipHealthCheck(req) ||
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS",
  handler: createRateLimitHandler("mutation", 50),
  validate: { keyGeneratorIpFallback: false },
});

// Search limiter — the directory search is the most abusable read path
// (each keystroke can drive a query), so it gets a tighter per-minute cap
// than general browsing. Keyed per-user since search now requires login.
// 1-minute window, 15 requests by default; tune via env for stricter tiers.
const SEARCH_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_SEARCH_WINDOW_MS) || 60_000;
const SEARCH_LIMIT_MAX = Number(process.env.RATE_LIMIT_SEARCH_MAX) || 15;
export const searchLimiter = rateLimit({
  windowMs: SEARCH_LIMIT_WINDOW_MS,
  limit: SEARCH_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(),
  skip: skipHealthCheck,
  handler: createRateLimitHandler("search", SEARCH_LIMIT_MAX),
  validate: { keyGeneratorIpFallback: false },
});

// Tight limiter for credential and one-time-code submissions (login,
// forgot-password, 2FA, ...). Mounted on `AUTH_LIMITED_PATHS` only, and counts
// submissions only — rendering the form does not spend the budget.
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(),
  skip: (req: Request) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
  handler: createRateLimitHandler("auth", 10),
  validate: { keyGeneratorIpFallback: false },
});

// Every route that accepts a password, reset request or one-time code. Each is
// listed with its `.data` twin: Express matches mount paths on segment
// boundaries, and `.data` is the URL React Router submits to.
export const AUTH_LIMITED_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify",
  "/2fa-verify",
  "/2fa-recovery",
  "/change-expired-password",
  "/accept-invite",
  "/sso/callback",
].flatMap((path) => [path, `${path}.data`]);
