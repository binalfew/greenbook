import { data } from "react-router";
import { RoleScope } from "~/generated/prisma/client";
import { getUserDetail } from "~/services/users.server";
import { prisma } from "~/utils/db/db.server";
import type { AuthUser } from "./require-auth.server";

export function isGlobalAdmin(actor: AuthUser): boolean {
  return actor.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");
}

/**
 * Load a user the actor is allowed to see, or throw. `user:*` permissions say
 * what an actor may do; this says to whom. Global admins reach every user.
 * Everyone else is confined to their own tenant — a user elsewhere is a 404,
 * so ids cannot be probed — and may not modify a holder of a GLOBAL-scope role.
 */
export async function requireUserInScope(actor: AuthUser, userId: string, mode: "read" | "write") {
  const user = await getUserDetail(userId);
  if (!user) throw data({ error: "User not found" }, { status: 404 });
  if (isGlobalAdmin(actor)) return user;

  if (!actor.tenantId || user.tenantId !== actor.tenantId) {
    throw data({ error: "User not found" }, { status: 404 });
  }
  if (mode === "write" && user.userRoles.some((ur) => ur.role.scope === RoleScope.GLOBAL)) {
    throw data(
      { error: "Forbidden", message: "Only platform admins can modify this user." },
      { status: 403 },
    );
  }
  return user;
}

/**
 * Reject role ids the actor may not grant. Only platform admins grant
 * GLOBAL-scope roles; otherwise a manager could hand out `admin`.
 */
export async function assertCanGrantRoles(actor: AuthUser, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0 || isGlobalAdmin(actor)) return;
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, scope: true },
  });
  const allowed = roles.filter((r) => r.scope === RoleScope.TENANT).length;
  if (allowed !== new Set(roleIds).size) {
    throw data(
      { error: "Forbidden", message: "Only platform admins can grant GLOBAL-scope roles." },
      { status: 403 },
    );
  }
}
