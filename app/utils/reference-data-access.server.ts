import { data } from "react-router";
import { requireActingTenant } from "~/utils/acting-tenant.server";
import { requirePermission, type AuthUser } from "~/utils/auth/require-auth.server";

// Member states, regional groups, organization types, position types and
// titles are one set shared by every tenant. Any tenant user with
// `reference-data:read` may look at them; only the global admin may change
// them, whatever permissions a tenant role carries.

/** Gate for the reference-data list pages. `canEdit` drives the New / Edit / Delete controls. */
export async function requireReferenceDataRead(
  request: Request,
): Promise<{ user: AuthUser; canEdit: boolean }> {
  const { isGlobalAdmin } = await requireActingTenant(request);
  const user = await requirePermission(request, "reference-data", "read");
  return { user, canEdit: isGlobalAdmin };
}

/** Gate for every loader and action that creates, edits or deletes reference data. */
export async function requireReferenceDataAdmin(request: Request): Promise<AuthUser> {
  const { user, isGlobalAdmin } = await requireActingTenant(request);
  if (!isGlobalAdmin) {
    throw data({ error: "Only the global admin can change reference data" }, { status: 403 });
  }
  return user;
}
