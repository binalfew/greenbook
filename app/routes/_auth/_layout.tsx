import { Outlet } from "react-router";
import { BrandedPanel, RightPanel } from "~/components/auth/auth-layout";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import type { Route } from "./+types/_layout";

/**
 * Auth group layout — renders a branded left panel + form-hosting right panel
 * for every `_auth/*` route (login, signup, forgot-password, 2fa-*, etc.).
 * Reads the language cookie so the in-panel language switcher defaults to the
 * right locale before the user has a tenant session.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const currentLanguage = getLangFromRequest(request) ?? "en";
  return { currentLanguage };
}

export default function AuthLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex min-h-svh">
      <BrandedPanel />
      <RightPanel currentLanguage={loaderData.currentLanguage}>
        <Outlet />
      </RightPanel>
    </div>
  );
}
