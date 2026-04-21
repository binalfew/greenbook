import { ArrowLeft, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { AssignmentTimeline, type TimelineEntry } from "~/components/directory/assignment-timeline";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { Badge } from "~/components/ui/badge";
import { publicGetPosition } from "~/services/positions.server";
import { formatDate } from "~/utils/format-date";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/$positionId";

export async function loader({ params }: Route.LoaderArgs) {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const position = isEmpty ? null : await publicGetPosition(params.positionId, publicTenantIds);
  if (!position) {
    throw data(null, { status: 404, headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
  }
  return data({ position }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicPositionDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { position } = loaderData;

  const currentHolder = position.assignments.find((a) => a.isCurrent);
  // Timeline entries must carry a stable `id`; the service doesn't select one
  // on assignments (only startDate/person), so we synthesise a local id from
  // the row index. Safe — entries are never re-ordered client-side.
  const timelineEntries: TimelineEntry[] = position.assignments.map((a, i) => ({
    id: `assignment-${i}`,
    startDate: a.startDate,
    endDate: a.endDate,
    isCurrent: a.isCurrent,
    person: a.person ?? undefined,
  }));

  return (
    <div className="space-y-6">
      <Link
        to={
          position.organization
            ? `/public/directory/organizations/${position.organization.id}`
            : "/public/directory/organizations"
        }
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("positionDetail.backToOrgs")}
      </Link>

      <header className="flex items-start gap-4">
        <div className="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-md">
          <Building2 className="size-6" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold">{position.title}</h1>
          {position.organization && (
            <p className="text-muted-foreground text-sm">
              {t("positionDetail.atOrganization", { org: position.organization.name })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {position.type && <Badge variant="outline">{position.type.name}</Badge>}
            {position.reportsTo && (
              <Badge variant="secondary">
                {t("positionDetail.reportsTo")}: {position.reportsTo.title}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {position.description && (
            <section>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                {position.description}
              </p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">{t("positionDetail.previousHolders")}</h2>
            <AssignmentTimeline
              entries={timelineEntries}
              mode="byPosition"
              basePrefix="/public/directory/people"
            />
          </section>
        </div>

        <aside className="space-y-4">
          <div className="bg-muted/30 space-y-2 rounded-md border p-4 text-sm">
            <div className="text-muted-foreground text-xs tracking-wide uppercase">
              {t("positionDetail.currentHolder")}
            </div>
            {currentHolder?.person ? (
              <Link
                to={`/public/directory/people/${currentHolder.person.id}`}
                className="text-primary font-medium hover:underline"
              >
                {[
                  currentHolder.person.honorific,
                  currentHolder.person.firstName,
                  currentHolder.person.lastName,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Link>
            ) : (
              <div className="text-muted-foreground">{t("positionDetail.vacant")}</div>
            )}
            {currentHolder && (
              <div className="text-muted-foreground text-xs">
                {t("orgDetail.established")}: {formatDate(currentHolder.startDate)}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="position" />;
}
