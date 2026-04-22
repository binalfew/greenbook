import { LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import logoUrl from "~/assets/logo.svg";
import { LanguageSwitcher } from "~/components/language-switcher";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { PUBLIC_CACHE_HEADER } from "~/utils/public-directory.server";
import { resolveBrandTheme } from "~/utils/theme.server";
import type { Route } from "./+types/_layout";

// Public cross-tenant chrome. Pathless layout — `_public` adds no URL
// segment, so children like `people/index.tsx` become `/people`. No
// tenant slug in the URL, no admin affordances, no "signed in as" UI.

export const handle = { i18n: "directory-public" };

export async function loader({ request }: Route.LoaderArgs) {
  const lang = getLangFromRequest(request) ?? "en";
  const brandTheme = await resolveBrandTheme(request);
  return data({ lang, brandTheme }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="bg-primary text-primary-foreground flex h-12 shrink-0 items-center gap-6 border-b pr-4 pl-2 sm:pr-6 sm:pl-3 lg:pr-8">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 self-stretch pr-3"
          aria-label={t("siteTitle")}
        >
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <img
              src={logoUrl}
              alt=""
              className="size-16 rounded-lg object-contain brightness-0 invert"
            />
          </span>
          <span className="hidden text-sm leading-none font-medium sm:block">{t("siteTitle")}</span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="[&_select]:text-primary-foreground [&_select]:bg-primary/80 [&_select]:border-primary-foreground/30">
            <LanguageSwitcher currentLanguage={loaderData.lang} />
          </div>
          <Link
            to="/login"
            className="border-primary-foreground/30 hover:bg-primary-foreground/10 text-primary-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors"
          >
            <LogIn className="size-4" />
            {t("signIn")}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
