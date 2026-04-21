import type { DirectoryEntity } from "~/generated/prisma/client.js";

// Map a DirectoryEntity enum value to the admin URL segment. Used by the
// change-detail page ("View current record" link), webhook delivery
// payloads, and any future deep-link generator. Keeps the single source of
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
