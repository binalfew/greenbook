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
    expect(permissions.filter((p) => p.resource === "reference-data").map((p) => p.action)).toEqual(
      ["read"],
    );
  });
});
