import { type ClientHint } from "./types";

/**
 * @beta
 */
export const timeZoneClientHint = {
  cookieName: "CH-time-zone",
  getValueCode: "Intl.DateTimeFormat().resolvedOptions().timeZone",
  fallback: "UTC",
} as const satisfies ClientHint<string>;
