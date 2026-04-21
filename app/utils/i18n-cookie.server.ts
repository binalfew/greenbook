import { isSupportedLanguage, type SupportedLanguage } from "~/utils/i18n";

const COOKIE_NAME = "i18n_lang";

/**
 * Read `i18n_lang` from the request cookie. Returns `null` if the cookie is
 * absent or names a language we don't ship.
 */
export function getLangFromRequest(request: Request): SupportedLanguage | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const [rawName, ...rest] = pair.split("=");
    if (!rawName) continue;
    if (rawName.trim() !== COOKIE_NAME) continue;
    const value = decodeURIComponent(rest.join("=").trim());
    return isSupportedLanguage(value) ? value : null;
  }

  return null;
}

/**
 * Build the `Set-Cookie` header value for persisting the selected language.
 * One-year expiry; HttpOnly omitted so the client-side `i18next` detector can
 * also read it (no sensitive data in this cookie).
 */
export function buildLangCookie(lang: SupportedLanguage): string {
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  return `${COOKIE_NAME}=${encodeURIComponent(lang)}; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export const I18N_COOKIE_NAME = COOKIE_NAME;
