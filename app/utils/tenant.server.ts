import { data } from "react-router";
import { prisma } from "~/utils/db/db.server";

/**
 * Resolve a tenant by URL slug. Throws a 404 Response when the slug does not
 * match any tenant — the caller typically surfaces this via the RR error
 * boundary.
 */
export async function resolveTenant(slug: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { slug, deletedAt: null },
  });
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }
  return tenant;
}
