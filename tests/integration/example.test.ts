import { describe, expect, it } from "vitest";
import { buildTenant } from "../factories";
import { prisma } from "../setup/integration-setup";

// Example integration test — hits the real test DB and exercises
// `beforeEach` truncation via the shared `prisma` client.
describe("tenant persistence", () => {
  it("round-trips a tenant through Postgres", async () => {
    const created = await prisma.tenant.create({ data: buildTenant() });
    const fetched = await prisma.tenant.findUnique({ where: { id: created.id } });

    expect(fetched?.slug).toBe(created.slug);
    expect(fetched?.email).toBe(created.email);
  });

  it("enforces unique tenant slug", async () => {
    const data = buildTenant();
    await prisma.tenant.create({ data });
    await expect(prisma.tenant.create({ data })).rejects.toThrow();
  });
});
