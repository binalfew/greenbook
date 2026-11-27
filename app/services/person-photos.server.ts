import sharp from "sharp";
import { prisma } from "~/utils/db/db.server";
import { PERSON_PHOTO_MAX_BYTES, PERSON_PHOTO_MAX_DIMENSION } from "~/utils/constants/person-photo";
import { logger } from "~/utils/monitoring/logger.server";
import { photoStorage, type StoredPhoto } from "~/utils/photo-storage.server";

// Person photos: validating and resizing an upload, deciding who may see a
// photo, and deleting photos nothing refers to any more.
//
// A photo is referenced by id from `Person.photoId` (published) or from the
// `photoId` of a person change request's payload (proposed, or rejected and
// still open to being reopened). The bytes are only ever touched through
// `photoStorage`.

export class PhotoUploadError extends Error {
  code: "TOO_LARGE" | "UNSUPPORTED_TYPE";
  constructor(code: PhotoUploadError["code"]) {
    super(code === "TOO_LARGE" ? "Photo is too large" : "Unsupported photo type");
    this.name = "PhotoUploadError";
    this.code = code;
  }
}

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);
const STORED_CONTENT_TYPE = "image/webp";

/** An upload that passed validation, resized and re-encoded, not yet stored. */
export type PreparedPhoto = { bytes: Buffer; width: number; height: number };

/**
 * Validate an uploaded file and turn it into a photo of at most 400×400, or
 * throw `PhotoUploadError`. The format is read from the file's content; its
 * name and declared type are ignored. The image is re-encoded, which drops
 * all metadata of the original.
 */
export async function preparePersonPhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > PERSON_PHOTO_MAX_BYTES) throw new PhotoUploadError("TOO_LARGE");

  let resized: { data: Buffer; info: { width: number; height: number } };
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 50_000_000 });
    const { format } = await image.metadata();
    if (!format || !ACCEPTED_FORMATS.has(format)) throw new PhotoUploadError("UNSUPPORTED_TYPE");
    resized = await image
      .rotate() // apply the camera's orientation before its metadata is dropped
      .resize(PERSON_PHOTO_MAX_DIMENSION, PERSON_PHOTO_MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (err instanceof PhotoUploadError) throw err;
    // sharp could not read it: not an image, or a damaged one.
    throw new PhotoUploadError("UNSUPPORTED_TYPE");
  }

  return { bytes: resized.data, width: resized.info.width, height: resized.info.height };
}

/** Store a prepared photo and return its id. */
export async function storePersonPhoto(
  photo: PreparedPhoto,
  owner: { tenantId: string; userId: string },
): Promise<string> {
  return photoStorage.put({
    tenantId: owner.tenantId,
    uploadedById: owner.userId,
    contentType: STORED_CONTENT_TYPE,
    ...photo,
  });
}

// ─── References ─────────────────────────────────────────────────────────

function payloadPhotoId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { photoId?: unknown }).photoId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The photos a change request has a stake in: the one it proposes and the
 * published one it may replace. Collect them BEFORE applying, discarding or
 * closing the request, then pass them to `releaseUnreferencedPhotos` after.
 */
export async function photosTouchedBy(change: {
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  payload: unknown;
}): Promise<string[]> {
  if (change.entityType !== "PERSON") return [];
  const ids = new Set<string>();
  const proposed = payloadPhotoId(change.payload);
  if (proposed) ids.add(proposed);
  if (change.entityId) {
    const person = await prisma.person.findFirst({
      where: { id: change.entityId, tenantId: change.tenantId },
      select: { photoId: true },
    });
    if (person?.photoId) ids.add(person.photoId);
  }
  return [...ids];
}

/**
 * The photos proposed by rejected requests that approving `change` puts out
 * of reach: the requests it was reopened from, and any other rejected request
 * against the same person (built on a version of the record that is now gone).
 */
export async function photosOfRejectionsClosedBy(change: {
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  clonedFromId?: string | null;
}): Promise<string[]> {
  if (change.entityType !== "PERSON") return [];
  const payloads: unknown[] = [];

  let parentId = change.clonedFromId ?? null;
  for (let depth = 0; parentId && depth < 50; depth++) {
    const parent: { payload: unknown; clonedFromId: string | null } | null =
      await prisma.changeRequest.findFirst({
        where: { id: parentId, tenantId: change.tenantId },
        select: { payload: true, clonedFromId: true },
      });
    if (!parent) break;
    payloads.push(parent.payload);
    parentId = parent.clonedFromId;
  }

  if (change.entityId) {
    const rejected = await prisma.changeRequest.findMany({
      where: {
        tenantId: change.tenantId,
        entityType: "PERSON",
        entityId: change.entityId,
        status: "REJECTED",
      },
      select: { payload: true },
    });
    payloads.push(...rejected.map((r) => r.payload));
  }

  return [...new Set(payloads.map(payloadPhotoId).filter((id) => id !== null))];
}

/**
 * A copy of a person payload for a reopened draft. A photo that no longer
 * exists is left out, which a draft reads as "leave the photo alone".
 */
export async function withoutMissingPhoto<T>(payload: T): Promise<T> {
  const photoId = payloadPhotoId(payload);
  if (!photoId || (await photoStorage.stat(photoId))) return payload;
  const { photoId: _gone, ...rest } = payload as T & { photoId?: unknown };
  return rest as T;
}

// A rejected request can be reopened as a draft carrying the same photo, so
// it holds on to that photo like a draft or a pending request does.
const HOLDING = ["DRAFT", "PENDING", "REJECTED"] as const;
const HOLDING_OPEN = ["DRAFT", "PENDING"] as const;

async function isReferenced(photoId: string, rejectedHolds: boolean): Promise<boolean> {
  const [people, changes] = await Promise.all([
    prisma.person.count({ where: { photoId, deletedAt: null } }),
    prisma.changeRequest.count({
      where: {
        entityType: "PERSON",
        status: { in: [...(rejectedHolds ? HOLDING : HOLDING_OPEN)] },
        payload: { path: ["photoId"], equals: photoId },
      },
    }),
  ]);
  return people + changes > 0;
}

/**
 * Delete each of the given photos that is neither a person's published photo
 * nor proposed by a draft, pending or rejected request. Pass
 * `rejectedHolds: false` when the operation ends the chance of reopening
 * (the reopened draft was discarded, or the record was changed): rejected
 * requests then no longer keep a photo alive. Safe to call with any ids at
 * any time. Never throws: cleanup must not undo the operation that led to it.
 */
export async function releaseUnreferencedPhotos(
  photoIds: string[],
  { rejectedHolds = true }: { rejectedHolds?: boolean } = {},
): Promise<void> {
  try {
    const orphaned: string[] = [];
    for (const id of new Set(photoIds)) {
      if (!(await isReferenced(id, rejectedHolds))) orphaned.push(id);
    }
    await photoStorage.delete(orphaned);
  } catch (err) {
    logger.error({ err, photoIds }, "failed to clean up person photos");
  }
}

/**
 * Which photo a saved form may keep pointing at. The id posted by the editor
 * is only honoured when it is this tenant's photo and either the record's
 * published photo or one the author uploaded; anything else falls back to the
 * record's published photo (null for a new person).
 */
export async function keepablePhotoId(
  requestedId: string | null | undefined,
  scope: { tenantId: string; userId: string; personId?: string },
): Promise<string | null> {
  const person = scope.personId
    ? await prisma.person.findFirst({
        where: { id: scope.personId, tenantId: scope.tenantId, deletedAt: null },
        select: { photoId: true },
      })
    : null;
  const published = person?.photoId ?? null;
  if (!requestedId || requestedId === published) return published;
  const photo = await photoStorage.stat(requestedId);
  const usable = photo?.tenantId === scope.tenantId && photo.uploadedById === scope.userId;
  return usable ? requestedId : published;
}

// ─── Reads ──────────────────────────────────────────────────────────────

/**
 * A photo as seen from a tenant's admin pages, or null when the viewer may
 * not see it. Published photos are open to everyone with access to the
 * tenant's directory. A proposed photo is visible to whoever uploaded it and,
 * once its request has left the draft stage, to reviewers.
 */
export async function getTenantPhoto(
  photoId: string,
  viewer: { tenantId: string; userId: string; canReview: boolean },
): Promise<StoredPhoto | null> {
  const photo = await photoStorage.stat(photoId);
  if (!photo || photo.tenantId !== viewer.tenantId) return null;

  let allowed = photo.uploadedById === viewer.userId;
  if (!allowed) {
    const published = await prisma.person.count({
      where: { photoId, tenantId: viewer.tenantId, deletedAt: null },
    });
    allowed = published > 0;
  }
  if (!allowed && viewer.canReview) {
    const submitted = await prisma.changeRequest.count({
      where: {
        tenantId: viewer.tenantId,
        entityType: "PERSON",
        status: { not: "DRAFT" },
        payload: { path: ["photoId"], equals: photoId },
      },
    });
    allowed = submitted > 0;
  }
  return allowed ? photoStorage.get(photoId) : null;
}

/** The published photo of a person in the cross-tenant directory, or null. */
export async function getDirectoryPersonPhoto(
  personId: string,
  publicTenantIds: string[],
): Promise<StoredPhoto | null> {
  if (publicTenantIds.length === 0) return null;
  const person = await prisma.person.findFirst({
    where: { id: personId, tenantId: { in: publicTenantIds }, deletedAt: null },
    select: { photoId: true },
  });
  return person?.photoId ? photoStorage.get(person.photoId) : null;
}

// Photos are only ever sent to a logged-in user, so the response is private.
// `no-cache` makes the browser revalidate (and so re-check the session) every
// time; a photo's content never changes, so its id doubles as the ETag.
const PHOTO_CACHE_HEADER = "private, no-cache";

export function photoResponse(request: Request, photo: StoredPhoto | null): Response {
  if (!photo) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const etag = `"${photo.id}"`;
  const headers = {
    "Cache-Control": PHOTO_CACHE_HEADER,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      ...headers,
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.byteLength),
    },
  });
}
