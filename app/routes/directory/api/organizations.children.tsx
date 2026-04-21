import { data, redirect } from "react-router";
import { publicListOrganizationChildren } from "~/services/organizations.server";
import { getPublicContext, publicOrgToTreeNode } from "~/utils/public-directory.server";
import type { Route } from "./+types/organizations.children";

// Public tree lazy-load. No auth, no tenant slug. Posts come from the
// HierarchyTree's childFetcher: { intent: "loadChildren", parentId }.
// The parent id is cross-tenant safe because `publicListOrganizationChildren`
// re-applies the opt-in gate — children from non-participating tenants
// are silently filtered out.

export async function loader() {
  return redirect("/directory/organizations");
}

export async function action({ request }: Route.ActionArgs) {
  const { publicTenantIds, isEmpty } = await getPublicContext();

  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "loadChildren") {
    return data({ error: "Unknown intent" }, { status: 400 });
  }

  const parentId = String(form.get("parentId") ?? "").trim();
  if (!parentId) {
    return data({ error: "parentId is required" }, { status: 400 });
  }

  if (isEmpty) return data({ children: [] });

  const rows = await publicListOrganizationChildren(parentId, publicTenantIds);
  const children = rows.map(publicOrgToTreeNode);

  return data(
    { children },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
  );
}
