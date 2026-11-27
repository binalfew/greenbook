import { Outlet } from "react-router";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/_layout";

export const handle = { breadcrumb: "Approvals" };

// Hosts the permission gate for the change-request views; the sidebar links to them.
export async function loader({ request }: Route.LoaderArgs) {
  const { canReview, canSubmit } = await requireDirectoryAccess(request);
  if (!canReview && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  return null;
}

export default function ChangesLayout() {
  return <Outlet />;
}
