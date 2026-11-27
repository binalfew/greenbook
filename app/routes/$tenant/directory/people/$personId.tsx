import { data } from "react-router";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { PersonProfile } from "~/components/public/person-profile";
import { requireActingTenant } from "~/utils/acting-tenant.server";
import { DIRECTORY_CACHE_HEADER, loadDirectoryProfile } from "~/utils/public-directory.server";
import type { Route } from "./+types/$personId";

// A directory profile inside the workspace: what `/people/<id>` shows
// readers, under the sidebar. The person may belong to any opted-in tenant.

export const handle = { breadcrumb: "Profile", i18n: "directory-public" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireActingTenant(request);
  const person = await loadDirectoryProfile(params.personId);
  return data({ person }, { headers: { "Cache-Control": DIRECTORY_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": DIRECTORY_CACHE_HEADER };
}

export default function WorkspacePersonProfile({ loaderData }: Route.ComponentProps) {
  return <PersonProfile person={loaderData.person} />;
}

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="person" />;
}
