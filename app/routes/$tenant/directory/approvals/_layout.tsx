import { Outlet } from "react-router";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/_layout";

export const handle = { breadcrumb: "Approvals" };

// The Pending / Mine / History tabs that used to live here are now inlined
// into the parent `$tenant/directory/_layout.tsx` NavTabs strip so the
// change-request views sit at the same nav depth as the entity views.
// This layout remains only to host the permission gate.
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
