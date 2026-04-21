import { redirect } from "react-router";
import { markAllAsRead } from "~/services/notifications.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/mark-all-read";

export const handle = { breadcrumb: "Mark all read" };

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireFeature(request, "FF_NOTIFICATIONS");
  await markAllAsRead(user.id);
  return redirect(`/${params.tenant}/notifications`);
}

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${params.tenant}/notifications`);
}
