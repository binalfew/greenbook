import { Outlet } from "react-router";
import { AuthBook } from "~/components/auth/auth-layout";
import { resolveBrandTheme } from "~/utils/theme.server";
import type { Route } from "./+types/_layout";

/**
 * Auth group layout — every `_auth/*` route (login, forgot-password,
 * reset-password, verify, change-expired-password) renders on the right page
 * of the open book. Resolves the brand theme from the last-visited tenant so
 * auth pages inherit the tenant's `data-brand` look.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const brandTheme = await resolveBrandTheme(request);
  return { brandTheme };
}

export default function AuthLayout() {
  return (
    <AuthBook>
      <Outlet />
    </AuthBook>
  );
}
