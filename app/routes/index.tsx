import { redirect } from "react-router";
import { getUserId } from "~/utils/auth/auth.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

// Root route — redirects to the directory landing for every visitor.
// Authenticated tenant users still get bounced to their tenant admin
// dashboard, preserving the "typed bare domain → my workspace" ergonomic
// for operators without re-showing them the public marketing page.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenant: { select: { slug: true } } },
    });
    if (user?.tenant?.slug) throw redirect(`/${user.tenant.slug}`);
  }
  throw redirect("/directory");
}
