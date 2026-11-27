import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isReservedSlug } from "~/utils/reserved-slugs";
import { createTenantSchema, updateTenantSchema } from "~/utils/schemas/tenant";

const ROUTES_DIR = path.resolve(__dirname, "../../app/routes");

/**
 * First URL segment of every route that does not live under `$tenant/`, read
 * straight from the routes directory using the auto-routes naming rules:
 * `_name` folders are pathless, `+name` folders are ignored, `$name` is a
 * param, and dots in a file name separate URL segments.
 */
function topLevelRouteSegments(dir = ROUTES_DIR): string[] {
  const segments: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.isDirectory() ? entry.name : entry.name.replace(/\.(tsx?|jsx?)$/, "");
    const first = name.split(".")[0].replace(/_$/, "");
    if (first.startsWith("+") || first.startsWith("$")) continue;
    if (first.startsWith("_")) {
      if (entry.isDirectory()) segments.push(...topLevelRouteSegments(path.join(dir, entry.name)));
      continue;
    }
    if (first === "index") continue;
    segments.push(first);
  }
  return [...new Set(segments)].sort();
}

describe("reserved tenant slugs", () => {
  it("finds the routes that live outside a tenant", () => {
    expect(topLevelRouteSegments()).toEqual(
      expect.arrayContaining(["api", "healthz", "login", "people", "resources", "sso", "up"]),
    );
  });

  it.each(topLevelRouteSegments())("reserves the top-level route segment %s", (segment) => {
    expect(isReservedSlug(segment)).toBe(true);
  });

  it("leaves an ordinary slug free", () => {
    expect(isReservedSlug("misd")).toBe(false);
  });

  it("is the list the create and edit forms validate against", () => {
    for (const slug of ["healthz", "sso"]) {
      const created = createTenantSchema.safeParse({
        name: "Health",
        slug,
        email: "health@example.org",
        phone: "+251 11 000 0000",
      });
      expect(created.success).toBe(false);
      expect(updateTenantSchema.safeParse({ slug }).success).toBe(false);
    }
  });
});
