import { redirect } from "react-router";
import { buildServiceContext } from "~/utils/request-context.server";
import type { ChangeRequest } from "~/generated/prisma/client.js";
import {
  findOwnDraftForEntity,
  getOwnDraft,
  saveDraft,
  submitAndApply,
  type SubmitInput,
} from "~/services/directory-changes.server";
import {
  requireDirectoryWriteAccess,
  type DirectoryAccess,
  type DirectoryResource,
} from "~/utils/directory-access.server";
import { DRAFT_PARAM } from "~/utils/directory-routes";

export type { DirectoryResource };

export type DirectorySubmitOutcome = {
  change: ChangeRequest;
  mode: "DRAFT" | "SELF_APPROVED";
};

/**
 * Dispatch a directory mutation to the change-request engine.
 *
 * Users with `<resource>:write` direct-apply (manager path). Users with
 * only `directory-change:submit` save a draft (focal-person path) — nothing
 * reaches a manager until the author submits it from their submissions list.
 * Users with neither 403.
 *
 * On the draft path a `?draft=<id>` on the request URL means "re-save that
 * draft" instead of creating a new one; the editors get it for free because
 * their forms post back to the URL they were loaded from.
 *
 * Returns the change row + which path ran so callers can pick where to go
 * next (the published record vs the author's drafts).
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
  const draftId = new URL(request.url).searchParams.get(DRAFT_PARAM) || undefined;
  const change = await saveDraft(input, ctx, { draftId });
  return { change, mode: "DRAFT" };
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

export type EditorDraft = { id: string; values: Record<string, unknown> };

/**
 * For the new / edit loaders: resolve the draft the editor should resume.
 *
 * - `?draft=<id>` → that draft's payload as form values (404 unless it is the
 *   caller's own draft for exactly this entity type / record).
 * - no param, editing a record the caller already has an UPDATE draft for →
 *   redirect to the same page with `?draft=` so the save updates that draft.
 * - otherwise `null` (managers never have drafts).
 */
export async function loadEditorDraft(
  request: Request,
  access: DirectoryAccess,
  entityType: SubmitInput["entityType"],
  entityId?: string,
): Promise<EditorDraft | null> {
  if (access.canDirect) return null;
  const ctx = buildServiceContext(request, access.user, access.tenantId);
  const url = new URL(request.url);
  const draftId = url.searchParams.get(DRAFT_PARAM);

  if (!draftId) {
    if (!entityId) return null;
    const own = await findOwnDraftForEntity(entityType, entityId, ctx);
    if (own?.operation !== "UPDATE") return null;
    url.searchParams.set(DRAFT_PARAM, own.id);
    throw redirect(`${url.pathname}${url.search}`);
  }

  const draft = await getOwnDraft(draftId, ctx);
  if (
    !draft ||
    draft.entityType !== entityType ||
    draft.operation !== (entityId ? "UPDATE" : "CREATE") ||
    draft.entityId !== (entityId ?? null)
  ) {
    throw new Response("Not Found", { status: 404 });
  }
  return { id: draft.id, values: draftFormValues(draft.payload) };
}

// Stored payloads are post-transform (`""` → null, nested initialAssignment);
// the editor forms want the flat pre-transform shape back.
function draftFormValues(payload: unknown): Record<string, unknown> {
  const { initialAssignment, ...rest } = (payload ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) values[key] = value ?? "";
  if (initialAssignment && typeof initialAssignment === "object") {
    const initial = initialAssignment as Record<string, unknown>;
    values.initialPositionId = initial.positionId ?? "";
    values.initialStartDate = initial.startDate ?? "";
    values.initialNotes = initial.notes ?? "";
  }
  return values;
}
