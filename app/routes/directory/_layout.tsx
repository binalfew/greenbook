import { LogIn, Network, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, data } from "react-router";
import logoUrl from "~/assets/logo.svg";
import { LanguageSwitcher } from "~/components/language-switcher";
import { cn } from "~/utils/misc";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { PUBLIC_CACHE_HEADER } from "~/utils/public-directory.server";
import { resolveBrandTheme } from "~/utils/theme.server";
import type { Route } from "./+types/_layout";

// Public cross-tenant directory chrome. No tenant slug in the URL, no
// admin affordances, no "signed in as" UI. Layout renders even when the
// directory is empty (no opt-in tenants); child routes handle empty states.

export const handle = { i18n: "directory-public" };

export async function loader({ request }: Route.LoaderArgs) {
  const lang = getLangFromRequest(request) ?? "en";
  const brandTheme = await resolveBrandTheme(request);
  return data({ lang, brandTheme }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicDirectoryLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const currentYear = new Date().getFullYear();

  // Primary-colored navbar for visual continuity with the tenant admin
  // chrome (bg-primary text-primary-foreground). Active links are shown
  // with an underline bar + brighter foreground; inactive links fade.
  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "relative inline-flex items-center gap-1.5 px-1 pt-1 pb-1 text-sm font-medium transition-colors",
      "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full",
      isActive
        ? "text-primary-foreground after:bg-primary-foreground"
        : "text-primary-foreground/80 after:bg-transparent hover:text-primary-foreground",
    );

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="bg-primary text-primary-foreground flex h-12 shrink-0 items-center gap-6 border-b pr-4 pl-2 sm:pr-6 sm:pl-3 lg:pr-8">
        <Link
          to="/directory"
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

        <nav className="flex flex-1 items-center gap-5" aria-label={t("siteTitle")}>
          <NavLink to="/directory" end className={navItemClass}>
            {t("home")}
          </NavLink>
          <NavLink to="/directory/organizations" className={navItemClass}>
            <Network className="size-4" />
            {t("organizations")}
          </NavLink>
          <NavLink to="/directory/people" className={navItemClass}>
            <Users className="size-4" />
            {t("people")}
          </NavLink>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-border/60 bg-muted/30 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6 lg:px-8">
          <p>{t("footer.copyright", { year: currentYear })}</p>
          <p className="mt-1">{t("footer.robots")}</p>
        </div>
      </footer>
    </div>
  );
}
