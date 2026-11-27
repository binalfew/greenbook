import { getTenantPhoto, photoResponse } from "~/services/person-photos.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/photos.$photoId";

// Resource route: a person photo for the tenant's admin pages (detail page,
// editor preview, approval diff). Login and tenant access are required; a
// photo the viewer may not see reads as not found.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canReview } = await requireDirectoryAccess(request);
  const photo = await getTenantPhoto(params.photoId, { tenantId, userId: user.id, canReview });
  return photoResponse(request, photo);
}
