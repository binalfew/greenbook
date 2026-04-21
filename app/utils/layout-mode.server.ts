import * as cookie from "cookie";
import type { LayoutMode } from "~/utils/layout-mode";

export type { LayoutMode };

const LAYOUT_MODE_COOKIE = "layout_mode";

const DEFAULT_MODE: LayoutMode = "sidebar";

export function getLayoutMode(request: Request): LayoutMode {
  const header = request.headers.get("cookie");
  const raw = header ? cookie.parse(header)[LAYOUT_MODE_COOKIE] : null;
  return raw === "navbar" ? "navbar" : DEFAULT_MODE;
}

/**
 * Build a `Set-Cookie` header that persists the layout-mode preference for
 * one year. Consumers pair this with a redirect so the next render picks up
 * the new mode.
 */
export function setLayoutModeCookie(mode: LayoutMode): string {
  return cookie.serialize(LAYOUT_MODE_COOKIE, mode, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
}
