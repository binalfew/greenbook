import { prisma } from "~/utils/db/db.server";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Idempotency wrapper for write API endpoints.
 *
 * If the incoming request carries an `Idempotency-Key` header, we check the
 * per-tenant idempotency store. A cached response is returned verbatim; a
 * miss runs the handler and caches its result. Uniqueness is scoped to
 * `(key, tenantId)` so keys can't leak across tenants.
 *
 * Callers are responsible for JSON-serialising their response body; the
 * helper handles encode/decode.
 *
 * Usage:
 *   export async function action({ request, params }: Route.ActionArgs) {
 *     const { user } = await requirePermission(request, "...", "write");
 *     return withIdempotency(request, user.tenantId!, async () => {
 *       const result = await createSomething(...);
 *       return { status: 201, body: result };
 *     });
 *   }
 */
export async function withIdempotency<T>(
  request: Request,
  tenantId: string,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return handler();

  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_tenantId: { key, tenantId } },
  });

  if (existing && existing.expiresAt > new Date()) {
    return {
      status: existing.statusCode,
      body: JSON.parse(existing.responseBody) as T,
    };
  }

  const result = await handler();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await prisma.idempotencyKey.upsert({
    where: { key_tenantId: { key, tenantId } },
    create: {
      key,
      tenantId,
      method: request.method,
      path: new URL(request.url).pathname,
      statusCode: result.status,
      responseBody: JSON.stringify(result.body),
      expiresAt,
    },
    update: {
      method: request.method,
      path: new URL(request.url).pathname,
      statusCode: result.status,
      responseBody: JSON.stringify(result.body),
      expiresAt,
    },
  });

  return result;
}
