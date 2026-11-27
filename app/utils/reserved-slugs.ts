/**
 * The one list of slugs a tenant may not take, because `/<slug>` is (or is
 * kept free for) a path the app serves itself. Tenant create and edit both
 * validate against it, client and server.
 *
 * Every first URL segment of a route outside `app/routes/$tenant/` must be
 * here — `tests/unit/reserved-slugs.test.ts` fails when one is missing.
 *
 * `system` is deliberately absent: it is a real tenant, so the duplicate-slug
 * check already keeps it from being handed out twice.
 */
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Auth screens
  "login",
  "logout",
  "signup",
  "forgot-password",
  "reset-password",
  "change-expired-password",
  "accept-invite",
  "verify",
  "sso",
  // Cross-tenant directory
  "people",
  "organizations",
  "positions",
  "directory",
  "public",
  // Resource and API routes
  "api",
  "resources",
  // Health checks
  "healthz",
  "up",
  // Static and offline shell
  "offline",
  "assets",
  // Kept free for future top-level paths
  "admin",
  "auth",
  "home",
  "onboarding",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export const RESERVED_SLUG_MESSAGE = "This slug is reserved and cannot be used";
export const DUPLICATE_SLUG_MESSAGE = "This slug is already used by another tenant";
