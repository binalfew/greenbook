import { data, redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { requireUserId } from "~/utils/auth/auth.server";
import { LAYOUT_MODES, type LayoutMode } from "~/utils/layout-mode";
import { setLayoutModeCookie } from "~/utils/layout-mode.server";
import type { Route } from "./+types/layout-mode";

export async function action({ request }: Route.ActionArgs) {
  await requireUserId(request);
  const formData = await request.formData();
  const mode = formData.get("mode");
  const redirectTo = formData.get("redirectTo");

  if (typeof mode !== "string" || !LAYOUT_MODES.includes(mode as LayoutMode)) {
    return data({ error: "Invalid mode" }, { status: 400 });
  }

  const target = safeRedirect(typeof redirectTo === "string" ? redirectTo : null, "/");
  return redirect(target, {
    headers: { "Set-Cookie": setLayoutModeCookie(mode as LayoutMode) },
  });
}
