// app/routes/up.tsx — cheap liveness probe (no DB touch).
// Used by monitors that only need to know Node is responding.
import type { Route } from "./+types/up";

export async function loader(_args: Route.LoaderArgs) {
  return Response.json(
    { status: "ok", uptime_ms: Math.round(process.uptime() * 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
