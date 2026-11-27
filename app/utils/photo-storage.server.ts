import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";

// Where person photos live: in the database. Everything that reads or writes
// a photo's row goes through the functions of this module.

export type PhotoInfo = {
  id: string;
  tenantId: string;
  uploadedById: string | null;
  contentType: string;
};

export type StoredPhoto = PhotoInfo & { bytes: Uint8Array };

export type NewPhoto = {
  tenantId: string;
  uploadedById: string;
  contentType: string;
  width: number;
  height: number;
  bytes: Uint8Array;
};

type Db = Prisma.TransactionClient | typeof prisma;

const info = { id: true, tenantId: true, uploadedById: true, contentType: true } as const;

/** Store a photo and return its id. */
export async function putPhoto(photo: NewPhoto): Promise<string> {
  const row = await prisma.personPhoto.create({
    data: {
      tenantId: photo.tenantId,
      uploadedById: photo.uploadedById,
      contentType: photo.contentType,
      width: photo.width,
      height: photo.height,
      size: photo.bytes.byteLength,
      data: new Uint8Array(photo.bytes),
    },
    select: { id: true },
  });
  return row.id;
}

/** The photo with its bytes, or null. */
export async function getPhoto(id: string): Promise<StoredPhoto | null> {
  const row = await prisma.personPhoto.findUnique({
    where: { id },
    select: { ...info, data: true },
  });
  if (!row) return null;
  const { data, ...rest } = row;
  return { ...rest, bytes: data };
}

/** The photo without its bytes, or null. Pass `db` to read inside a transaction. */
export async function statPhoto(id: string, db: Db = prisma): Promise<PhotoInfo | null> {
  return db.personPhoto.findUnique({ where: { id }, select: info });
}

export async function deletePhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.personPhoto.deleteMany({ where: { id: { in: ids } } });
}
