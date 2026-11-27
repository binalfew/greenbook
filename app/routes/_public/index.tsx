import { data, redirect } from "react-router";
import { DirectorySearch } from "~/components/public/directory-search";
import { getUserId, requireUserId } from "~/utils/auth/auth.server";
import { hasOperatorRole } from "~/utils/auth/post-login-redirect.server";
import { prisma } from "~/utils/db/db.server";
import { DIRECTORY_CACHE_HEADER, loadDirectorySearch } from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

// Landing at `/` — the directory search for readers. The directory serves AU
// staff and member states only, so a login is required before any search.
// Operators are bounced to their tenant dashboard, so typing the bare domain
// lands them in their workspace; they search from `/<tenant>/directory`.

export async function loader({ request }: Route.LoaderArgs) {
  // Operator shortcut — authenticated *operators* skip the search page and go
  // straight to their admin dashboard. Directory readers (`user` role) stay
  // here, even though they also have a home tenant.
  const userId = await getUserId(request);
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        tenant: { select: { slug: true } },
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    const isOperator = hasOperatorRole(user?.userRoles.map((ur) => ur.role.name) ?? []);
    if (isOperator && user?.tenant?.slug) throw redirect(`/${user.tenant.slug}`);
  } else {
    // Login required for any search. Bounce anonymous visitors to /login,
    // preserving the query so they land back on their search after signing in.
    await requireUserId(request);
  }

  return data(await loadDirectorySearch(request), {
    headers: { "Cache-Control": DIRECTORY_CACHE_HEADER },
  });
}

export function headers() {
  return { "Cache-Control": DIRECTORY_CACHE_HEADER };
}

export default function PublicPeopleIndex({ loaderData }: Route.ComponentProps) {
  return <DirectorySearch results={loaderData} />;
}
