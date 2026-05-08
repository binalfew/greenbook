import { LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, Outlet, data } from "react-router";
import logoUrl from "~/assets/logo.svg";
import { LanguageSwitcher } from "~/components/language-switcher";
import { Button } from "~/components/ui/button";
import { getUserId } from "~/utils/auth/auth.server";
import { prisma } from "~/utils/db/db.server";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { PUBLIC_CACHE_HEADER } from "~/utils/public-directory.server";
import { resolveBrandTheme } from "~/utils/theme.server";
import type { Route } from "./+types/_layout";

// Public cross-tenant chrome. Pathless layout — `_public` adds no URL
// segment, so children like `people/index.tsx` become `/people`. No
// tenant slug in the URL, no admin affordances.
//
// The header *is* auth-aware: tenantless authenticated users (regular users
// who SSO'd in but aren't tenant admins) see their own name + a logout
// button instead of a "Sign In" link, so they don't loop on /login.

export const handle = { i18n: "directory-public" };

interface CurrentUser {
  firstName: string;
  lastName: string;
  email: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const lang = getLangFromRequest(request) ?? "en";
  const brandTheme = await resolveBrandTheme(request);

  const userId = await getUserId(request);
  let currentUser: CurrentUser | null = null;
  if (userId) {
    currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
  }

  // When the response carries per-user state, drop the public cache. The
  // anonymous case keeps PUBLIC_CACHE_HEADER for edge caching.
  const cacheHeader = currentUser ? "private, no-store" : PUBLIC_CACHE_HEADER;

  return data({ lang, brandTheme, currentUser }, { headers: { "Cache-Control": cacheHeader } });
}

// `headers()` is called for unauthenticated visitors hitting this layout
// without a child loader response — keep the public default for them. For
// authenticated users the loader's per-response header above takes effect.
export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

function userInitials(user: CurrentUser): string {
  const a = user.firstName?.[0] ?? "";
  const b = user.lastName?.[0] ?? "";
  const combined = `${a}${b}`.toUpperCase();
  return combined || user.email[0].toUpperCase();
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { currentUser } = loaderData;

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

          {currentUser ? (
            <div className="flex items-center gap-2">
              <span
                className="bg-primary-foreground/15 text-primary-foreground inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold"
                aria-hidden="true"
              >
                {userInitials(currentUser)}
              </span>
              <span className="hidden text-sm font-medium sm:inline">
                {currentUser.firstName} {currentUser.lastName}
              </span>
              <Form method="post" action="/logout">
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground h-8 gap-1.5"
                >
                  <LogOut className="size-4" />
                  <span className="sr-only sm:not-sr-only">Sign out</span>
                </Button>
              </Form>
            </div>
          ) : (
            <Link
              to="/login"
              className="border-primary-foreground/30 hover:bg-primary-foreground/10 text-primary-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors"
            >
              <LogIn className="size-4" />
              {t("signIn")}
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
