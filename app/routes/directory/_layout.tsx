import { Network, Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, data } from "react-router";
import { LanguageSwitcher } from "~/components/language-switcher";
import { cn } from "~/utils/misc";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { PUBLIC_CACHE_HEADER } from "~/utils/public-directory.server";
import type { Route } from "./+types/_layout";

// Public cross-tenant directory chrome. No tenant slug in the URL, no
// admin affordances, no "signed in as" UI. Layout renders even when the
// directory is empty (no opt-in tenants); child routes handle empty states.

export const handle = { i18n: "directory-public" };

export async function loader({ request }: Route.LoaderArgs) {
  const lang = getLangFromRequest(request) ?? "en";
  return data({ lang }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicDirectoryLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const currentYear = new Date().getFullYear();

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-1.5 border-b-2 px-1 pt-1 pb-3 text-sm font-medium transition-colors",
      isActive
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
    );

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border/60 bg-card/50 border-b backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/directory" className="flex items-center gap-3">
              <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-md font-bold">
                AU
              </div>
              <div>
                <div className="text-base font-semibold">{t("siteTitle")}</div>
                <div className="text-muted-foreground text-xs">{t("siteTagline")}</div>
              </div>
            </Link>
            <LanguageSwitcher currentLanguage={loaderData.lang} />
          </div>
          <nav className="mt-4 flex flex-wrap gap-6" aria-label={t("siteTitle")}>
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
            <NavLink
              to="/directory/organizations?q="
              className={navItemClass}
              aria-label={t("search")}
            >
              <Search className="size-4" />
              {t("search")}
            </NavLink>
          </nav>
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
