import type { DirectoryEntity } from "~/generated/prisma/client.js";

// Map a DirectoryEntity enum value to the admin URL segment. Used by the
// change-detail page ("View current record" link) and any future
// deep-link generator. Keeps the single source of
// truth next to the enum shape rather than scattered across route files.
//
// POSITION_ASSIGNMENT doesn't have its own admin index — assignments live
// under their parent Position's detail page, so we return the Position
// segment and callers are expected to append the position id.

const SEGMENT: Record<DirectoryEntity, string> = {
  ORGANIZATION: "organizations",
  PERSON: "people",
  POSITION: "positions",
  POSITION_ASSIGNMENT: "positions",
};

export function directoryEntitySegment(entity: DirectoryEntity): string {
  return SEGMENT[entity];
}

// Query param carrying the id of the draft an editor page is resuming. The
// editor forms post back to their own URL, so the param reaches
// `dispatchDirectoryChange`, which re-saves that draft instead of creating one.
export const DRAFT_PARAM = "draft";

/** Where the author goes after saving a draft: their drafts, ready to submit. */
export function draftsPath(tenantSlug: string): string {
  return `/${tenantSlug}/directory/submissions?status=DRAFT`;
}

/**
 * Editor URL that resumes a draft, or null when the draft has no editor
 * (DELETE / MOVE requests and assignment dialogs — discard and redo those).
 */
export function draftEditPath(
  tenantSlug: string,
  draft: { id: string; entityType: DirectoryEntity; operation: string; entityId: string | null },
): string | null {
  if (draft.entityType === "POSITION_ASSIGNMENT") return null;
  const base = `/${tenantSlug}/directory/${SEGMENT[draft.entityType]}`;
  const query = `?${DRAFT_PARAM}=${draft.id}`;
  if (draft.operation === "CREATE") return `${base}/new${query}`;
  if (draft.operation === "UPDATE" && draft.entityId) {
    return `${base}/${draft.entityId}/edit${query}`;
  }
  return null;
}
