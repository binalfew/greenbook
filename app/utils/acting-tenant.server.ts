import { data } from "react-router";
import { RoleScope } from "~/generated/prisma/client";
import {
  requireAuth,
  requirePermission,
  type AuthUser,
  type PermissionAction,
  type PermissionResource,
} from "~/utils/auth/require-auth.server";
import { resolveTenant } from "~/utils/tenant.server";

// Tenant-scoped pages live under `/:tenant/...` and act on that tenant — the
// "acting tenant" — not on the signed-in user's home tenant. A global admin
// may act on any tenant; everyone else is confined to their home tenant.
//
// This is the single place that rule is enforced. Route loaders and actions
// reach it through `requireDirectoryAccess` (directory) or
// `requireTenantPermission` (audit log) and must not read `user.tenantId` to
// scope a query.

export type ActingTenant = {
  user: AuthUser;
  /** Id of the tenant named in the URL. */
  tenantId: string;
  isGlobalAdmin: boolean;
};

function tenantSlugFromUrl(request: Request): string {
  const [slug] = new URL(request.url).pathname.split("/").filter(Boolean);
  if (!slug) throw data({ error: "Tenant not found" }, { status: 404 });
  return decodeURIComponent(slug);
}

/**
 * Resolve the tenant the request acts on. Throws 404 when the URL names no
 * existing tenant and 403 when the user may not act on it.
 */
export async function requireActingTenant(request: Request): Promise<ActingTenant> {
  const user = await requireAuth(request);
  const tenant = await resolveTenant(tenantSlugFromUrl(request));
  const isGlobalAdmin = user.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");
  if (!isGlobalAdmin && user.tenantId !== tenant.id) {
    throw data({ error: "You do not have access to this tenant" }, { status: 403 });
  }
  return { user, tenantId: tenant.id, isGlobalAdmin };
}

/** `requirePermission`, scoped to the acting tenant. */
export async function requireTenantPermission(
  request: Request,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<ActingTenant> {
  const acting = await requireActingTenant(request);
  await requirePermission(request, resource, action);
  return acting;
}
