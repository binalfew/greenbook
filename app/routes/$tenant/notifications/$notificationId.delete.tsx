import { redirect } from "react-router";
import { deleteNotification } from "~/services/notifications.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/$notificationId.delete";

export const handle = { breadcrumb: "Delete" };

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireFeature(request, "FF_NOTIFICATIONS");
  await deleteNotification(params.notificationId, user.id);
  return redirect(`/${params.tenant}/notifications`);
}

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${params.tenant}/notifications`);
}
