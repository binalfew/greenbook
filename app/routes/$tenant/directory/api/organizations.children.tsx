import { data, redirect } from "react-router";
import { listOrganizationChildren } from "~/services/organizations.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/organizations.children";

// Resource route used by the organizations tree for lazy-loading children.
// Posts arrive from react-arborist's onToggle flow: { intent: "loadChildren", parentId }.
// Response shape matches the include-shape of `listRootOrganizations` so the
// tree's `transformOrgNodes` can treat parent + child uniformly.

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${params.tenant}/directory/organizations`);
}

export async function action({ request }: Route.ActionArgs) {
  const { tenantId } = await requireDirectoryAccess(request);

  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "loadChildren") {
    return data({ error: "Unknown intent" }, { status: 400 });
  }

  const parentId = String(form.get("parentId") ?? "").trim();
  if (!parentId) {
    return data({ error: "parentId is required" }, { status: 400 });
  }

  const children = await listOrganizationChildren(parentId, tenantId);
  return data({ children });
}
