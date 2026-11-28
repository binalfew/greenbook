import { data } from "react-router";
import {
  requireAuth,
  requirePermission,
  type AuthUser,
  type PermissionAction,
  type PermissionResource,
} from "~/utils/auth/require-auth.server";
import { isGlobalAdmin } from "~/utils/auth/user-access.server";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { resolveTenant } from "~/utils/tenant.server";

// Tenant-scoped pages live under `/:tenant/...` and act on that tenant — the
// "acting tenant" — not on the signed-in user's home tenant. A global admin
// may act on any tenant; everyone else is confined to their home tenant.
//
// This is the single place that rule is enforced. Route loaders and actions
// reach it through `requireDirectoryAccess` (directory),
// `requireTenantPermission` or `requireTenantFeature` and must not read
// `user.tenantId` to scope a query.

export type ActingTenant = {
  user: AuthUser;
  /** Id of the tenant named in the URL. */
  tenantId: string;
  /** Its slug. */
  tenantSlug: string;
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
  const globalAdmin = isGlobalAdmin(user);
  if (!globalAdmin && user.tenantId !== tenant.id) {
    throw data({ error: "You do not have access to this tenant" }, { status: 403 });
  }
  return { user, tenantId: tenant.id, tenantSlug: tenant.slug, isGlobalAdmin: globalAdmin };
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

/**
 * Gate a route on a feature flag, as the tenant layout does for the pages it
 * links to: for the acting tenant, or against the flag's own switch for a
 * global admin. Throws 404 when the feature is off.
 */
export async function requireTenantFeature(
  request: Request,
  flagKey: string,
): Promise<ActingTenant> {
  const acting = await requireActingTenant(request);
  const roles = acting.user.roles.map((r) => r.name);
  const enabled = await isFeatureEnabled(
    flagKey,
    acting.isGlobalAdmin
      ? { roles, userId: acting.user.id }
      : { tenantId: acting.tenantId, roles, userId: acting.user.id },
  );
  if (!enabled) throw data({ error: "Not Found" }, { status: 404 });
  return acting;
}
