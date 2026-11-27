import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";

// Where person photos live. Everything that reads or writes a photo goes
// through `photoStorage`, so moving the files to object storage means writing
// a second implementation of this interface and copying the rows across.

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

export interface PhotoStorage {
  /** Store a photo and return its id. */
  put(photo: NewPhoto): Promise<string>;
  /** The photo with its bytes, or null. */
  get(id: string): Promise<StoredPhoto | null>;
  /** The photo without its bytes, or null. Pass `db` to read inside a transaction. */
  stat(id: string, db?: Db): Promise<PhotoInfo | null>;
  delete(ids: string[]): Promise<void>;
}

const info = { id: true, tenantId: true, uploadedById: true, contentType: true } as const;

const databasePhotoStorage: PhotoStorage = {
  async put(photo) {
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
  },

  async get(id) {
    const row = await prisma.personPhoto.findUnique({
      where: { id },
      select: { ...info, data: true },
    });
    if (!row) return null;
    const { data, ...rest } = row;
    return { ...rest, bytes: data };
  },

  async stat(id, db = prisma) {
    return db.personPhoto.findUnique({ where: { id }, select: info });
  },

  async delete(ids) {
    if (ids.length === 0) return;
    await prisma.personPhoto.deleteMany({ where: { id: { in: ids } } });
  },
};

export const photoStorage: PhotoStorage = databasePhotoStorage;
