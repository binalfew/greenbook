import { Outlet } from "react-router";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/_layout";

// Pathless layout: the folder groups the directory's routes behind one access
// gate without adding a URL segment, so they sit at `/<tenant>/people` etc.
// The sidebar (`app/config/navigation.ts`) links to each section.
export async function loader({ request }: Route.LoaderArgs) {
  const { canReview, canSubmit } = await requireDirectoryAccess(request);
  return { canReview, canSubmit };
}

export default function DirectoryLayout() {
  return <Outlet />;
}
