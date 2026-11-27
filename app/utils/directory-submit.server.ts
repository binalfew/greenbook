import { buildServiceContext } from "~/utils/request-context.server";
import type { ChangeRequest } from "~/generated/prisma/client.js";
import enDirectory from "~/locales/en/directory.json";
import frDirectory from "~/locales/fr/directory.json";
import {
  submitAndApply,
  submitChange,
  type SubmitInput,
} from "~/services/directory-changes.server";
import {
  requireDirectoryWriteAccess,
  type DirectoryResource,
} from "~/utils/directory-access.server";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";

export type { DirectoryResource };

export type DirectorySubmitOutcome = {
  change: ChangeRequest;
  mode: "REVIEWED" | "SELF_APPROVED";
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
  "VERSION_CONFLICT",
  "HAS_ACTIVE_ASSIGNMENTS",
  "REFERENCED_RECORD_NOT_PUBLISHED",
  "NOT_PENDING",
] as const;

export type DirectoryConflictCode = (typeof CONFLICT_CODES)[number];

export type DirectoryConflict = { code: DirectoryConflictCode; message: string };

/** What a directory dispatch produced: the change, or the conflict that stopped it. */
export type DirectorySubmitResult =
  | (DirectorySubmitOutcome & { conflict?: undefined })
  | { conflict: DirectoryConflict; change?: undefined; mode?: undefined };

const CONFLICT_MESSAGES = { en: enDirectory.conflicts, fr: frDirectory.conflicts };

/**
 * The conflict behind a thrown error, with its message in the request's
 * language, or `null` when the error is not a known conflict (the caller
 * must rethrow it).
 */
export function directoryConflictFrom(request: Request, err: unknown): DirectoryConflict | null {
  if (!(err instanceof Error) || !("code" in err)) return null;
  const code = CONFLICT_CODES.find((c) => c === err.code);
  if (!code) return null;
  const lang = getLangFromRequest(request) ?? "en";
  return { code, message: CONFLICT_MESSAGES[lang][code] };
}

/**
 * Dispatch a directory mutation to the change-request engine.
 *
 * Users with `<resource>:write` direct-apply (manager path). Users with
 * only `directory-change:submit` queue for review (focal-person path).
 * Users with neither 403.
 *
 * Returns the change row + which path ran so callers can pick a toast
 * ("Saved and published" vs "Submitted for review"), or `{ conflict }` when
 * a known conflict stopped the change — callers show `conflict.message` on
 * their form.
 */
export async function dispatchDirectoryChange(
  request: Request,
  resource: DirectoryResource,
  input: SubmitInput,
): Promise<DirectorySubmitResult> {
  const { user, tenantId, canDirect } = await requireDirectoryWriteAccess(request, resource);

  const ctx = buildServiceContext(request, user, tenantId);
  try {
    if (canDirect) {
      const result = await submitAndApply(input, ctx);
      return { change: result.change, mode: "SELF_APPROVED" };
    }
    const change = await submitChange(input, ctx);
    return { change, mode: "REVIEWED" };
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
