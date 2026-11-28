import { data } from "react-router";
import { requireActingTenant } from "~/utils/acting-tenant.server";
import { hasPermission, type AuthUser } from "~/utils/auth/require-auth.server";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import type { ChangeContext } from "~/services/directory-changes.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { DirectoryEntityKey } from "~/utils/schemas/directory";

// The directory subsystem has a specific role shape: a viewer can read, a
// focal person can submit change requests, and a manager can write directly.
// Every route loader/action does the same four-line dance to resolve this.
// This helper collapses it and returns the flags routes need for UI gating.
//
// Pass `resource` to check per-entity write access (Organization, Person,
// Position, PositionAssignment). Omit it for pure read-only routes.
//
// The structure of the directory — organizational units and positions — is
// kept by the global admin alone. Focal persons and managers read it and
// assign people to positions, but they can neither change it directly (the
// seed gives them no `organization:write` / `position:write`) nor propose a
// change to it: `directory-change:submit` does not reach these two resources.

export type DirectoryResource = "organization" | "person" | "position" | "position-assignment";

/** Resources changed only by direct write, never through a submitted change. */
const ADMIN_MANAGED: Partial<Record<DirectoryResource, DirectoryEntityKey>> = {
  organization: "ORGANIZATION",
  position: "POSITION",
};

export type DirectoryAccess = {
  user: AuthUser;
  /**
   * The acting tenant: the one named in the URL, which for a global admin
   * need not be their home tenant. Scope every query and write by this.
   */
  tenantId: string;
  /** User can direct-apply CRUD against the named resource (manager path). */
  canDirect: boolean;
  /** User can propose changes: `saveDraft`, then `submitDrafts` (focal-person path). */
  canSubmit: boolean;
  /**
   * User can propose a change to the named resource. Same as `canSubmit`,
   * except that it is false for organizations and positions, which nobody
   * proposes changes to. False when no resource was named.
   */
  canPropose: boolean;
  /** User can review (read) others' change requests. */
  canReview: boolean;
  /** User can approve pending change requests. */
  canApprove: boolean;
  /** User can reject pending change requests. */
  canReject: boolean;
};

export async function requireDirectoryAccess(
  request: Request,
  options: { write?: DirectoryResource } = {},
): Promise<DirectoryAccess> {
  const { user, tenantId } = await requireActingTenant(request);
  // The directory is on or off per tenant, and the tenant that counts is the
  // acting one, for the global admin too: a tenant that is not opted in
  // (the system tenant never is) has no directory for anyone.
  if (!(await isFeatureEnabled("FF_DIRECTORY", { tenantId }))) {
    throw data({ error: "Not Found" }, { status: 404 });
  }
  const canDirect = options.write ? hasPermission(user, options.write, "write") : false;
  const canSubmit = hasPermission(user, "directory-change", "submit");
  const canPropose = canSubmit && !!options.write && !ADMIN_MANAGED[options.write];
  const canReview = hasPermission(user, "directory-change", "read-all");
  const canApprove = hasPermission(user, "directory-change", "approve");
  const canReject = hasPermission(user, "directory-change", "reject");
  return { user, tenantId, canDirect, canSubmit, canPropose, canReview, canApprove, canReject };
}

/**
 * The service context for a change-request call. It names the entity types
 * this user may not move through the workflow, so a draft or pending change
 * to an organization or position left over from before they became
 * admin-only cannot be saved, submitted, reopened or approved by someone
 * without the write permission.
 */
export function directoryContext(
  request: Request,
  access: Pick<DirectoryAccess, "user" | "tenantId">,
): ChangeContext {
  const lockedEntityTypes = Object.entries(ADMIN_MANAGED)
    .filter(([resource]) => !hasPermission(access.user, resource, "write"))
    .map(([, entityType]) => entityType);
  return { ...buildServiceContext(request, access.user, access.tenantId), lockedEntityTypes };
}

/**
 * Gate a write route (new / edit / delete): fails 403 when the user has
 * neither direct-write permission nor the right to propose a change to this
 * resource (nobody has the latter for organizations and positions). Returns the same
 * `DirectoryAccess` shape so loaders can pass `canDirect` to the editor
 * for the right button label.
 */
export async function requireDirectoryWriteAccess(
  request: Request,
  resource: DirectoryResource,
): Promise<DirectoryAccess> {
  const access = await requireDirectoryAccess(request, { write: resource });
  if (!access.canDirect && !access.canPropose) {
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
): Promise<DirectoryAccess & { ctx: ChangeContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canReview) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = directoryContext(request, access);
  return { ...access, ctx };
}

export async function requireSubmitContext(
  request: Request,
): Promise<DirectoryAccess & { ctx: ChangeContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = directoryContext(request, access);
  return { ...access, ctx };
}

// Approve/reject actions gate on the dedicated `directory-change:approve` /
// `:reject` permissions — not merely `read-all`. Previously both actions used
// `requireReviewContext` (read-all), so any role that could *view* the queue
// could also mutate it, and the granular approve/reject permissions went
// unenforced.
export async function requireApproveContext(
  request: Request,
): Promise<DirectoryAccess & { ctx: ChangeContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canApprove) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = directoryContext(request, access);
  return { ...access, ctx };
}

export async function requireRejectContext(
  request: Request,
): Promise<DirectoryAccess & { ctx: ChangeContext }> {
  const access = await requireDirectoryAccess(request);
  if (!access.canReject) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ctx = directoryContext(request, access);
  return { ...access, ctx };
}
