// app/routes/healthz.tsx
//
// Liveness + readiness probe.
//   · 200 {"status":"ok", ...}       process is up AND Postgres reachable
//   · 503 {"status":"degraded", ...} process is up but Postgres failed
//
// Used by:
//   · Docker container healthcheck (compose healthcheck block — 07 §8.2.3)
//   · /usr/local/bin/greenbook-health.sh (§9.3)
//   · Uptime monitors / external probes
//   · Nginx's `skipHealthCheck` in server/security.ts so this route is
//     never rate-limited.

import type { Route } from "./+types/healthz";
import { prisma } from "~/utils/db/db.server";

export async function loader(_args: Route.LoaderArgs) {
  const started = Date.now();
  const checks: Record<string, "ok" | string> = { process: "ok" };

  // Cheap DB probe via the Prisma adapter. "SELECT 1" is <1 ms and doesn't
  // touch any table. DO NOT extend this to real queries — every container
  // hits this every 30s and you don't want to pay for N+1 "is the DB
  // healthy" roundtrips.
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch (err) {
    checks.db = err instanceof Error ? err.message : "unknown";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return Response.json(
    {
      status: allOk ? "ok" : "degraded",
      uptime_ms: Math.round(process.uptime() * 1000),
      timestamp: new Date().toISOString(),
      service: process.env.APP_NAME ?? "greenbook",
      version: process.env.APP_VERSION ?? "dev",
      checks,
      took_ms: Date.now() - started,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        // Never cache health probes — otherwise a 5-minute CDN cache would
        // keep reporting "ok" after the DB went down.
        "Cache-Control": "no-store",
      },
    },
  );
}
