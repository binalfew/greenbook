import { data } from "react-router";
import { DirectorySearch } from "~/components/public/directory-search";
import { requireActingTenant } from "~/utils/acting-tenant.server";
import { DIRECTORY_CACHE_HEADER, loadDirectorySearch } from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

// The cross-tenant directory search, inside the workspace: the same search
// readers get at `/`, kept under the sidebar for people who have one. It
// reads every opted-in tenant, not just the one in the URL.

export const handle = { breadcrumb: "Directory", i18n: "directory-public" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireActingTenant(request);
  return data(await loadDirectorySearch(request), {
    headers: { "Cache-Control": DIRECTORY_CACHE_HEADER },
  });
}

export function headers() {
  return { "Cache-Control": DIRECTORY_CACHE_HEADER };
}

export default function WorkspaceDirectorySearch({ loaderData }: Route.ComponentProps) {
  return <DirectorySearch results={loaderData} />;
}
