import { hasPermission, requireFeature, type AuthUser } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { TenantServiceContext } from "~/utils/types.server";

// The directory subsystem has a specific role shape: a viewer can read, a
// focal person can submit change requests, and a manager can write directly.
// Every route loader/action does the same four-line dance to resolve this.
// This helper collapses it and returns the flags routes need for UI gating.
//
// Pass `resource` to check per-entity write access (Organization, Person,
// Position, PositionAssignment). Omit it for pure read-only routes.

export type DirectoryResource = "organization" | "person" | "position" | "position-assignment";

export type DirectoryAccess = {
  user: AuthUser;
  tenantId: string;
  /** User can direct-apply CRUD against the named resource (manager path). */
  canDirect: boolean;
  /** User can create a ChangeRequest via `submitChange` (focal-person path). */
  canSubmit: boolean;
  /** User can review others' change requests. */
  canReview: boolean;
};

export async function requireDirectoryAccess(
  request: Request,
  options: { write?: DirectoryResource } = {},
): Promise<DirectoryAccess> {
  const { user, tenantId } = await requireFeature(request, "FF_DIRECTORY");
  const canDirect = options.write ? hasPermission(user, options.write, "write") : false;
  const canSubmit = hasPermission(user, "directory-change", "submit");
  const canReview = hasPermission(user, "directory-change", "read-all");
  return { user, tenantId, canDirect, canSubmit, canReview };
}

/**
 * Gate a write route (new / edit / delete): fails 403 when the user has
 * neither direct-write permission nor submit-for-review. Returns the same
 * `DirectoryAccess` shape so loaders can pass `canDirect` to the editor
 * for the right button label.
 */
export async function requireDirectoryWriteAccess(
  request: Request,
  resource: DirectoryResource,
): Promise<DirectoryAccess> {
  const access = await requireDirectoryAccess(request, { write: resource });
  if (!access.canDirect && !access.canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  return access;
}

// Shorthand for change-request action routes that need a service context.
// Collapses `requireDirectoryAccess + buildServiceContext + gate` into one
// call. Throws 403 on missing permission; no need for the caller to double
// the check.
export async function requireReviewContext(
  request: Request,
): Promise<DirectoryAccess & { ctx: TenantServiceContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canReview) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = buildServiceContext(request, access.user, access.tenantId);
  return { ...access, ctx };
}

export async function requireSubmitContext(
  request: Request,
): Promise<DirectoryAccess & { ctx: TenantServiceContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = buildServiceContext(request, access.user, access.tenantId);
  return { ...access, ctx };
}
