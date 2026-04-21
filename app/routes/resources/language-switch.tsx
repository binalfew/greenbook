import { data, redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { buildLangCookie } from "~/utils/i18n-cookie.server";
import { isSupportedLanguage } from "~/utils/i18n";
import type { Route } from "./+types/language-switch";

export async function loader() {
  throw redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const rawLang = formData.get("lang");
  const redirectTo = (formData.get("redirectTo") as string | null) ?? "/";

  if (typeof rawLang !== "string" || !isSupportedLanguage(rawLang)) {
    return data({ error: "Unsupported language" }, { status: 400 });
  }

  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": buildLangCookie(rawLang) },
  });
}
