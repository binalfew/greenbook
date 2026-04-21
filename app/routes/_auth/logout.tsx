import { redirect } from "react-router";
import { logout } from "~/utils/auth/auth.server";
import { getImpersonationState, stopImpersonating } from "~/utils/auth/session.server";
import type { Route } from "../+types";

export async function loader() {
  return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  // If the current session is impersonating, unwind the impersonation state
  // (and emit the audit event) before we destroy the session cookie.
  const state = await getImpersonationState(request);
  if (state.isImpersonating) {
    await stopImpersonating(request, "/");
  }
  return logout({ request });
}
