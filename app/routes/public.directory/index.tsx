import { ArrowRight, Network, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { Button } from "~/components/ui/button";
import { publicListOrganizationTreeRoots } from "~/services/organizations.server";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

// Landing page for the cross-tenant public directory. Shows hero + roots.

export async function loader() {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const featuredRoots = isEmpty ? [] : await publicListOrganizationTreeRoots(publicTenantIds);
  return data({ featuredRoots, isEmpty }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicDirectoryLanding({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { featuredRoots, isEmpty } = loaderData;

  if (isEmpty) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-2xl font-semibold">{t("landing.emptyOverall")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t("landing.emptyOverallHelp")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("landing.hero")}</h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-relaxed">
          {t("landing.heroDescription")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/public/directory/organizations">
              <Network />
              {t("landing.browseOrgs")}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/public/directory/people">
              <Users />
              {t("landing.browsePeople")}
            </Link>
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("landing.featuredOrgs")}</h2>
        {featuredRoots.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("landing.featuredOrgsEmpty")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featuredRoots.map((org) => (
              <Link
                key={org.id}
                to={`/public/directory/organizations/${org.id}`}
                className="bg-card hover:border-primary/60 group border-border relative flex flex-col gap-2 rounded-lg border p-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-md">
                    <Network className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{org.name}</div>
                    {org.acronym && (
                      <div className="text-muted-foreground text-xs">{org.acronym}</div>
                    )}
                  </div>
                </div>
                {org.childCount > 0 && (
                  <div className="text-muted-foreground mt-auto text-xs">
                    {t("landing.subordinateCount", { count: org.childCount })}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
