import { redirect } from "react-router";
import { directoryNotificationPath } from "~/services/directory-notifications.server";
import { openNotification } from "~/services/notifications.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/$notificationId.open";

export const handle = { breadcrumb: "Open" };

// Where a click on a notification lands: it is marked read and the user is
// sent to what it is about, or to the inbox when it has no page of its own.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireFeature(request, "FF_NOTIFICATIONS");
  const notification = await openNotification(params.notificationId, user.id);
  if (!notification) {
    throw new Response("Not Found", { status: 404 });
  }
  const path = directoryNotificationPath(notification) ?? "/notifications";
  return redirect(`/${params.tenant}${path}`);
}
