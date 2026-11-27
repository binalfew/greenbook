import { getDirectoryPersonPhoto } from "~/services/person-photos.server";
import { requireUserId } from "~/utils/auth/auth.server";
import { photoResponse } from "~/utils/photo-response.server";
import { getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/$personId_.photo";

// Resource route: the published photo on a cross-tenant directory profile.
// Login required, like the profile itself; never tenant-aware.
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);
  const { publicTenantIds } = await getPublicContext();
  const photo = await getDirectoryPersonPhoto(params.personId, publicTenantIds);
  return photoResponse(request, photo);
}
