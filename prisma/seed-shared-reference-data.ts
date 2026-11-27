import type { Prisma, PrismaClient } from "../app/generated/prisma/client";

/**
 * Reference data (organization types, position types, regional groups, member
 * states, titles) is one set shared by every tenant. Before that rule each
 * tenant held its own copy, so a database that predates it has one row per
 * tenant for the same code.
 *
 * This keeps one row per code and points every directory record, and every
 * change request payload, that referenced a dropped copy at the kept row.
 * The kept row is the oldest one still in use (not deleted / still active),
 * and it keeps its own name, settings and region memberships.
 *
 * Idempotent: a second run finds no duplicates and changes nothing.
 * Returns the number of rows removed.
 */
export async function mergeDuplicateReferenceData(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const live = { id: true, code: true, deletedAt: true, createdAt: true } as const;
      const organizationTypes = planMerge(
        (await tx.organizationType.findMany({ select: live })).map(softDeletable),
      );
      const positionTypes = planMerge(
        (await tx.positionType.findMany({ select: live })).map(softDeletable),
      );
      const regionalGroups = planMerge(
        (await tx.regionalGroup.findMany({ select: live })).map(softDeletable),
      );
      const memberStates = planMerge(
        (
          await tx.memberState.findMany({
            select: { id: true, abbreviation: true, deletedAt: true, createdAt: true },
          })
        ).map((r) => softDeletable({ ...r, code: r.abbreviation })),
      );
      const titles = planMerge(
        (
          await tx.title.findMany({
            select: { id: true, code: true, isActive: true, createdAt: true },
          })
        ).map((r) => ({ id: r.id, code: r.code, retired: !r.isActive, createdAt: r.createdAt })),
      );

      const removed =
        organizationTypes.size +
        positionTypes.size +
        regionalGroups.size +
        memberStates.size +
        titles.size;
      if (removed === 0) return 0;

      // Raw updates on purpose: this is a data move, not an edit, so the
      // records' `updatedAt` and `version` stay as they were.
      for (const [from, to] of organizationTypes) {
        await tx.$executeRaw`UPDATE "Organization" SET "typeId" = ${to} WHERE "typeId" = ${from}`;
      }
      for (const [from, to] of positionTypes) {
        await tx.$executeRaw`UPDATE "Position" SET "typeId" = ${to} WHERE "typeId" = ${from}`;
      }
      for (const [from, to] of memberStates) {
        await tx.$executeRaw`UPDATE "Person" SET "memberStateId" = ${to} WHERE "memberStateId" = ${from}`;
      }

      // A kept member state keeps its own regions; a region link that points
      // at a dropped regional group moves to the kept group. Links of dropped
      // member states go with them.
      for (const [from, to] of regionalGroups) {
        await tx.$executeRaw`
          UPDATE "MemberStateRegion" r SET "regionalGroupId" = ${to}
          WHERE r."regionalGroupId" = ${from}
            AND NOT EXISTS (
              SELECT 1 FROM "MemberStateRegion" k
              WHERE k."memberStateId" = r."memberStateId" AND k."regionalGroupId" = ${to}
            )`;
      }

      // Change requests carry reference ids inside their JSON payload.
      const idMap = new Map([...organizationTypes, ...positionTypes, ...memberStates]);
      if (idMap.size > 0) {
        const changes = await tx.changeRequest.findMany({ select: { id: true, payload: true } });
        for (const change of changes) {
          const payload = remapIds(change.payload, idMap);
          if (payload.changed) {
            await tx.$executeRaw`
              UPDATE "ChangeRequest" SET "payload" = ${JSON.stringify(payload.value)}::jsonb
              WHERE "id" = ${change.id}`;
          }
        }
      }

      await tx.organizationType.deleteMany({
        where: { id: { in: [...organizationTypes.keys()] } },
      });
      await tx.positionType.deleteMany({ where: { id: { in: [...positionTypes.keys()] } } });
      await tx.memberState.deleteMany({ where: { id: { in: [...memberStates.keys()] } } });
      await tx.regionalGroup.deleteMany({ where: { id: { in: [...regionalGroups.keys()] } } });
      await tx.title.deleteMany({ where: { id: { in: [...titles.keys()] } } });
      return removed;
    },
    { timeout: 120_000 },
  );
}

type Candidate = { id: string; code: string; retired: boolean; createdAt: Date };

function softDeletable(row: { id: string; code: string; deletedAt: Date | null; createdAt: Date }) {
  return { id: row.id, code: row.code, retired: row.deletedAt !== null, createdAt: row.createdAt };
}

/** Maps the id of every row to drop onto the id of the row kept for its code. */
function planMerge(rows: Candidate[]): Map<string, string> {
  const ordered = [...rows].sort(
    (a, b) =>
      Number(a.retired) - Number(b.retired) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const keeperByCode = new Map<string, string>();
  const merge = new Map<string, string>();
  for (const row of ordered) {
    const keeper = keeperByCode.get(row.code);
    if (keeper) merge.set(row.id, keeper);
    else keeperByCode.set(row.code, row.id);
  }
  return merge;
}

function remapIds(
  value: Prisma.JsonValue,
  idMap: Map<string, string>,
): { value: Prisma.JsonValue; changed: boolean } {
  if (typeof value === "string") {
    const to = idMap.get(value);
    return to ? { value: to, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => remapIds(item, idMap));
    return { value: items.map((i) => i.value), changed: items.some((i) => i.changed) };
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const out: Record<string, Prisma.JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = remapIds(item as Prisma.JsonValue, idMap);
      out[key] = mapped.value;
      changed ||= mapped.changed;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}
