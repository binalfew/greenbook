import { ArrowLeft, Globe, Mail, MapPin, Network, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { Badge } from "~/components/ui/badge";
import { publicGetOrganization } from "~/services/organizations.server";
import { formatDate } from "~/utils/format-date";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/$orgId";

export async function loader({ params }: Route.LoaderArgs) {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const org = isEmpty ? null : await publicGetOrganization(params.orgId, publicTenantIds);
  if (!org) {
    // Throw a 404 response so the root error boundary renders the not-found UI;
    // keeps public responses from leaking existence via shape differences.
    throw data(null, { status: 404, headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
  }
  return data({ org }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicOrganizationDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { org } = loaderData;

  return (
    <div className="space-y-6">
      <Link
        to="/public/directory/organizations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("orgDetail.backToOrgs")}
      </Link>

      <header className="space-y-3">
        <div className="flex items-start gap-4">
          <div className="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-md">
            <Network className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{org.name}</h1>
            {org.acronym && <p className="text-muted-foreground text-sm">{org.acronym}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{org.type.name}</Badge>
              {org.parent && (
                <Badge variant="secondary">
                  <Link to={`/public/directory/organizations/${org.parent.id}`}>
                    {org.parent.acronym ?? org.parent.name}
                  </Link>
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {org.mandate && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t("orgDetail.mandate")}</h2>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{org.mandate}</p>
            </section>
          )}
          {org.description && (
            <section>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{org.description}</p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">{t("orgDetail.positions")}</h2>
            {org.positions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("orgDetail.positionsEmpty")}</p>
            ) : (
              <ul className="divide-border divide-y rounded-md border">
                {org.positions.map((pos) => (
                  <li key={pos.id}>
                    <Link
                      to={`/public/directory/positions/${pos.id}`}
                      className="hover:bg-muted/60 flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{pos.title}</div>
                        {pos.type && (
                          <div className="text-muted-foreground text-xs">{pos.type.name}</div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="bg-muted/30 space-y-3 rounded-md border p-4 text-sm">
            {org.establishmentDate && (
              <div>
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  {t("orgDetail.established")}
                </div>
                <div>{formatDate(org.establishmentDate)}</div>
              </div>
            )}
            {(org.website || org.email || org.phone || org.address) && (
              <div className="space-y-2 pt-2">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  {t("orgDetail.contact")}
                </div>
                {org.website && (
                  <a
                    href={org.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary flex items-center gap-2 text-sm hover:underline"
                  >
                    <Globe className="size-4" />
                    {org.website}
                  </a>
                )}
                {org.email && (
                  <a
                    href={`mailto:${org.email}`}
                    className="text-primary flex items-center gap-2 text-sm hover:underline"
                  >
                    <Mail className="size-4" />
                    {org.email}
                  </a>
                )}
                {org.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="size-4" />
                    {org.phone}
                  </div>
                )}
                {org.address && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    <span className="whitespace-pre-wrap">{org.address}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="org" />;
}
