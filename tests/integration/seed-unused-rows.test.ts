import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../setup/integration-setup";

import { runSeed } from "../../prisma/seed";

// Feature flags and permissions that no code checks are not seeded, and the
// seed clears them out of a database that still carries them.

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const sorted = (values: string[]) => [...new Set(values)].sort();

describe("running the seed", () => {
  it("seeds only the feature flags the app checks", async () => {
    await runSeed();

    const flags = await prisma.featureFlag.findMany();
    expect(sorted(flags.map((f) => f.key))).toEqual([
      "FF_DIRECTORY",
      "FF_I18N",
      "FF_NOTIFICATIONS",
      "FF_PUBLIC_DIRECTORY",
      "FF_PWA",
    ]);
  });

  it("seeds only the permissions the app checks", async () => {
    await runSeed();

    const permissions = await prisma.permission.findMany();
    expect(sorted(permissions.map((p) => p.resource))).toEqual([
      "audit-log",
      "directory-change",
      "feature-flag",
      "organization",
      "person",
      "position",
      "position-assignment",
      "reference-data",
      "role",
      "settings",
      "sso",
      "user",
    ]);
    expect(permissions.filter((p) => p.resource === "role").map((p) => p.action)).toEqual(["read"]);
  });

  it("removes unused permissions from an existing database and keeps the others", async () => {
    await runSeed();
    const admin = await prisma.role.findFirstOrThrow({ where: { name: "admin" } });
    for (const [resource, action] of [
      ["tenant", "create"],
      ["permission", "delete"],
      ["role", "update"],
      ["notification", "read"],
      ["saved-view", "write"],
      ["report", "read"],
    ]) {
      await prisma.permission.create({
        data: {
          resource,
          action,
          module: "system",
          rolePermissions: { create: { roleId: admin.id, access: "any" } },
        },
      });
    }

    await runSeed();

    const left = await prisma.permission.findMany({
      where: {
        OR: [
          { resource: { in: ["tenant", "permission", "notification", "saved-view", "report"] } },
          { resource: "role", action: { not: "read" } },
        ],
      },
    });
    expect(left.map((p) => `${p.resource}:${p.action}`)).toEqual(["report:read"]);
  });
});
