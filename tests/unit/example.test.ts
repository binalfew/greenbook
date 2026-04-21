import { describe, expect, it } from "vitest";
import { buildTenant, buildUser } from "../factories";

// Example unit test — exercises the factory helpers without hitting the DB.
// Real unit tests go in tests/unit/services/ and tests/unit/utils/ alongside
// the production code they cover.
describe("factories", () => {
  it("buildTenant returns sequentially unique slugs", () => {
    const a = buildTenant();
    const b = buildTenant();
    expect(a.slug).not.toBe(b.slug);
    expect(a.email).toMatch(/@test\.com$/);
  });

  it("buildUser accepts overrides", () => {
    const u = buildUser({ firstName: "Ada" });
    expect(u.firstName).toBe("Ada");
    expect(u.email).toMatch(/^user\d+@test\.com$/);
  });
});
