import { redirect } from "react-router";
import type { ChangeRequest } from "~/generated/prisma/client.js";
import enDirectory from "~/locales/en/directory.json";
import frDirectory from "~/locales/fr/directory.json";
import {
  findOwnDraftForEntity,
  getOwnDraft,
  getReopenedFrom,
  saveDraft,
  submitAndApply,
  toDraftRejection,
  type BatchResult,
  type DraftRejection,
  type SubmitInput,
} from "~/services/directory-changes.server";
import {
  directoryContext,
  requireDirectoryWriteAccess,
  type DirectoryAccess,
  type DirectoryResource,
} from "~/utils/directory-access.server";
import { DRAFT_PARAM } from "~/utils/directory-routes";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";

export type { DirectoryResource };

export type DirectorySubmitOutcome = {
  change: ChangeRequest;
  mode: "DRAFT" | "SELF_APPROVED";
};

// ─── Conflicts ──────────────────────────────────────────────────────────
//
// The engine and the entity writers signal ordinary conflicts by throwing an
// error carrying one of these codes. They are expected outcomes of normal
// use, so they are turned into a message for the form or dialog that was
// submitted. This is the only place that decides which codes count and what
// the user is told; the wording lives in the `directory` locale namespace
// under `conflicts.<code>`.
const CONFLICT_CODES = [
  "PENDING_REQUEST_EXISTS",
  "DRAFT_EXISTS",
  "VERSION_CONFLICT",
  "HAS_ACTIVE_ASSIGNMENTS",
  "REFERENCED_RECORD_NOT_PUBLISHED",
  "NOT_PENDING",
  "RECORD_CHANGED",
  "ALREADY_REOPENED",
  "NOT_REJECTED",
  "EMPTY_BATCH",
  "BATCH_TOO_LARGE",
  "ADMIN_MANAGED",
] as const;

export type DirectoryConflictCode = (typeof CONFLICT_CODES)[number];

export type DirectoryConflict = { code: DirectoryConflictCode; message: string };

/** What a directory dispatch produced: the change, or the conflict that stopped it. */
export type DirectorySubmitResult =
  | (DirectorySubmitOutcome & { conflict?: undefined })
  | { conflict: DirectoryConflict; change?: undefined; mode?: undefined };

const MESSAGES = { en: enDirectory, fr: frDirectory };

/** The `directory` locale namespace in the request's language, for text composed on the server. */
export function directoryMessages(request: Request) {
  return MESSAGES[getLangFromRequest(request) ?? "en"];
}

function errorCode(err: unknown): unknown {
  return err instanceof Error && "code" in err ? err.code : undefined;
}

/**
 * The conflict behind a thrown error, with its message in the request's
 * language, or `null` when the error is not a known conflict (the caller
 * must rethrow it).
 */
export function directoryConflictFrom(request: Request, err: unknown): DirectoryConflict | null {
  const code = CONFLICT_CODES.find((c) => c === errorCode(err));
  if (!code) return null;
  return { code, message: directoryMessages(request).conflicts[code] };
}

/**
 * For the action of a dialog that acts on one change request: the conflict to
 * show on the dialog. A request the user cannot see becomes a 404 and one
 * they may not act on a 403; anything that is not a known conflict is
 * rethrown.
 */
export function directoryDialogConflict(request: Request, err: unknown): DirectoryConflict {
  const code = errorCode(err);
  if (code === "NOT_FOUND") throw new Response("Not Found", { status: 404 });
  if (code === "NOT_SUBMITTER") throw new Response("Forbidden", { status: 403 });
  const conflict = directoryConflictFrom(request, err);
  if (!conflict) throw err;
  return conflict;
}

/** What a batch action tells the page: which ids went through and why the others did not. */
export type DirectoryBatchOutcome = {
  succeeded: { id: string }[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; code: string; message: string }[];
};

/**
 * Run a batch action and describe the outcome in the request's language.
 * `error` is set, with no `result`, when the whole batch was refused (nothing
 * selected, too many selected).
 */
export async function runDirectoryBatch(
  request: Request,
  run: () => Promise<BatchResult>,
): Promise<
  | { result: DirectoryBatchOutcome; error: null; status: 200 }
  | { result: null; error: string; status: 400 }
> {
  let result: BatchResult;
  try {
    result = await run();
  } catch (err) {
    const conflict = directoryConflictFrom(request, err);
    if (!conflict) throw err;
    return { result: null, error: conflict.message, status: 400 };
  }
  const { conflicts } = directoryMessages(request);
  return {
    result: {
      succeeded: result.succeeded.map(({ id }) => ({ id })),
      skipped: result.skipped.map(({ id, reason }) => ({ id, reason })),
      failed: result.failed.map(({ id, code }) => ({
        id,
        code,
        message: conflicts[CONFLICT_CODES.find((c) => c === code) ?? "UNKNOWN"],
      })),
    },
    error: null,
    status: 200,
  };
}

/**
 * Dispatch a directory mutation to the change-request engine.
 *
 * Users with `<resource>:write` direct-apply (manager path). Users with
 * only `directory-change:submit` save a draft (focal-person path) — nothing
 * reaches a manager until the author submits it from their submissions list.
 * Users with neither 403, and so does anyone without `<resource>:write` when
 * the resource is an organization or a position: those are never proposed.
 *
 * On the draft path a `?draft=<id>` on the request URL means "re-save that
 * draft" instead of creating a new one; the editors get it for free because
 * their forms post back to the URL they were loaded from.
 *
 * Returns the change row + which path ran so callers can pick where to go
 * next (the published record vs the author's drafts), or `{ conflict }` when
 * a known conflict stopped the change — callers show `conflict.message` on
 * their form.
 */
export async function dispatchDirectoryChange(
  request: Request,
  resource: DirectoryResource,
  input: SubmitInput,
): Promise<DirectorySubmitResult> {
  const access = await requireDirectoryWriteAccess(request, resource);
  const { canDirect } = access;

  const ctx = directoryContext(request, access);
  try {
    if (canDirect) {
      const result = await submitAndApply(input, ctx);
      return { change: result.change, mode: "SELF_APPROVED" };
    }
    const draftId = new URL(request.url).searchParams.get(DRAFT_PARAM) || undefined;
    const change = await saveDraft(input, ctx, { draftId });
    return { change, mode: "DRAFT" };
  } catch (err) {
    const conflict = directoryConflictFrom(request, err);
    if (!conflict) throw err;
    return { conflict };
  }
}

export async function dispatchDirectoryDelete(
  request: Request,
  resource: DirectoryResource,
  entityType: SubmitInput["entityType"],
  entityId: string,
  reason?: string,
): Promise<DirectorySubmitResult> {
  return dispatchDirectoryChange(request, resource, {
    entityType,
    operation: "DELETE",
    entityId,
    payload: reason ? { reason } : {},
  });
}

export type EditorDraft = {
  id: string;
  values: Record<string, unknown>;
  /** Set when the draft reopens a rejected request; shown above the editor. */
  rejection: DraftRejection | null;
};

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
  const ctx = directoryContext(request, access);
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
  const rejection = toDraftRejection(await getReopenedFrom(draft));
  return { id: draft.id, values: draftFormValues(draft.payload), rejection };
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
