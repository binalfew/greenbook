import * as cookie from "cookie";
import { createCookie } from "react-router";
import { prisma } from "~/utils/db/db.server";

const cookieName = "theme";
export type Theme = "light" | "dark";

export function getTheme(request: Request): Theme | null {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : "light";
  if (parsed === "light" || parsed === "dark") return parsed;
  return null;
}

export function setTheme(theme: Theme | "system") {
  if (theme === "system") {
    return cookie.serialize(cookieName, "", { path: "/", maxAge: -1 });
  } else {
    return cookie.serialize(cookieName, theme, { path: "/", maxAge: 31536000 });
  }
}

// Cookie that remembers the last-visited tenant slug. Every tenant page
// load refreshes it; non-tenant pages (/login, /directory) read it to
// apply the same `data-brand` theme as the tenant pages so the user sees
// a consistent AU-branded look across the whole site.
export const brandCookie = createCookie("brand", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * Resolve the brand theme for tenant-less routes (login / public directory).
 * Reads the `brand` cookie for the last-visited tenant slug, looks up
 * that tenant's `brandTheme`, and returns it.
 *
 * When no cookie is present (first-time visitors), `fallbackSlug` is
 * consulted so the site still shows its baseline brand — for Greenbook,
 * the `system` tenant's `brandTheme` is "auc" which gives the AU look
 * on /login and /directory out of the box. Pass `null` to opt out.
 */
export async function resolveBrandTheme(
  request: Request,
  { fallbackSlug = "system" }: { fallbackSlug?: string | null } = {},
): Promise<string> {
  const cookieSlug = await brandCookie.parse(request.headers.get("Cookie"));
  const slug = typeof cookieSlug === "string" && cookieSlug ? cookieSlug : fallbackSlug;
  if (!slug) return "";

  const tenant = await prisma.tenant.findFirst({
    where: { slug, deletedAt: null },
    select: { brandTheme: true },
  });
  return tenant?.brandTheme ?? "";
}
