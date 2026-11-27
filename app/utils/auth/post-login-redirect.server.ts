import { prisma } from "~/utils/db/db.server";

// Roles that operate a tenant workspace. Only these users are sent to their
// tenant admin dashboard after login (or when hitting the bare domain). The
// plain `user` role is a cross-tenant directory reader — it belongs on the
// directory search at `/`, even though it also has a home tenant.
export const OPERATOR_ROLES = new Set(["admin", "manager", "focal"]);

export function hasOperatorRole(roleNames: Iterable<string>): boolean {
  for (const name of roleNames) {
    if (OPERATOR_ROLES.has(name)) return true;
  }
  return false;
}

/**
 * Where an authenticated user should land when no explicit `redirectTo` is
 * given. Operators (admin/manager/focal) go to their tenant workspace; plain
 * directory readers (`user` role) and tenantless users land on the directory
 * search at `/`.
 */
export async function resolvePostLoginRedirect(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tenant: { select: { slug: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user) return "/";
  const isOperator = hasOperatorRole(user.userRoles.map((ur) => ur.role.name));
  return isOperator && user.tenant?.slug ? `/${user.tenant.slug}` : "/";
}
