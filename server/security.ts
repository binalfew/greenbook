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

// Tight limiter for /login, /signup, /forgot-password, etc. Apps mount
// this on their auth routes explicitly; it's not applied globally.
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(),
  skip: skipHealthCheck,
  handler: createRateLimitHandler("auth", 10),
  validate: { keyGeneratorIpFallback: false },
});
