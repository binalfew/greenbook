/**
 * Feature flag keys — client-safe.
 *
 * The server-only SDK in `feature-flags.server.ts` imports these so the
 * constants stay in one place; components that only need the key name (to
 * index into `enabledFeatures`) import from here to avoid pulling the server
 * module into the client bundle.
 */
export const FEATURE_FLAG_KEYS = {
  TWO_FACTOR: "FF_TWO_FACTOR",
  IMPERSONATION: "FF_IMPERSONATION",
  WEBHOOKS: "FF_WEBHOOKS",
  NOTIFICATIONS: "FF_NOTIFICATIONS",
  PWA: "FF_PWA",
  I18N: "FF_I18N",
  AUDIT_EXPORT: "FF_AUDIT_EXPORT",
  DIRECTORY: "FF_DIRECTORY",
  PUBLIC_DIRECTORY: "FF_PUBLIC_DIRECTORY",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
