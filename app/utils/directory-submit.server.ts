import { buildServiceContext } from "~/utils/request-context.server";
import type { ChangeRequest } from "~/generated/prisma/client.js";
import {
  submitAndApply,
  submitChange,
  type SubmitInput,
} from "~/services/directory-changes.server";
import {
  requireDirectoryWriteAccess,
  type DirectoryResource,
} from "~/utils/directory-access.server";

export type { DirectoryResource };

export type DirectorySubmitOutcome = {
  change: ChangeRequest;
  mode: "REVIEWED" | "SELF_APPROVED";
};

/**
 * Dispatch a directory mutation to the change-request engine.
 *
 * Users with `<resource>:write` direct-apply (manager path). Users with
 * only `directory-change:submit` queue for review (focal-person path).
 * Users with neither 403.
 *
 * Returns the change row + which path ran so callers can pick a toast
 * ("Saved and published" vs "Submitted for review").
 */
export async function dispatchDirectoryChange(
  request: Request,
  resource: DirectoryResource,
  input: SubmitInput,
): Promise<DirectorySubmitOutcome> {
  const { user, tenantId, canDirect } = await requireDirectoryWriteAccess(request, resource);

  const ctx = buildServiceContext(request, user, tenantId);
  if (canDirect) {
    const result = await submitAndApply(input, ctx);
    return { change: result.change, mode: "SELF_APPROVED" };
  }
  const change = await submitChange(input, ctx);
  return { change, mode: "REVIEWED" };
}

export async function dispatchDirectoryDelete(
  request: Request,
  resource: DirectoryResource,
  entityType: SubmitInput["entityType"],
  entityId: string,
  reason?: string,
): Promise<DirectorySubmitOutcome> {
  return dispatchDirectoryChange(request, resource, {
    entityType,
    operation: "DELETE",
    entityId,
    payload: reason ? { reason } : {},
  });
}
