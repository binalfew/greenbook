import { ArrowLeft, Pencil, Trash2, UserCog, UserPlus, UserX, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import { AssignmentTimeline } from "~/components/directory/assignment-timeline";
import { PendingBadge } from "~/components/directory/pending-badge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { getPosition } from "~/services/positions.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { formatDate } from "~/utils/format-date";
import type { Route } from "./+types/$positionId._layout";

export const handle = { breadcrumb: "Position" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "position",
  });
  const canWrite = canDirect;
  const canDelete = hasPermission(user, "position", "delete");
  const canAssignDirect = hasPermission(user, "position-assignment", "write");

  const [position, pendingChange] = await Promise.all([
    getPosition(params.positionId, tenantId),
    prisma.changeRequest.findFirst({
      where: {
        tenantId,
        status: "PENDING",
        entityType: "POSITION",
        entityId: params.positionId,
      },
      select: { id: true, submittedById: true },
    }),
  ]);

  return data({
    position,
    pendingChange,
    canWrite,
    canDelete,
    canSubmit,
    canAssign: canAssignDirect || canSubmit,
    currentUserId: user.id,
  });
}

export default function PositionDetailLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { position, pendingChange, canWrite, canDelete, canSubmit, canAssign, currentUserId } =
    loaderData;
  const base = `/${params.tenant}/directory/positions`;
  const peopleBase = `/${params.tenant}/directory/people`;
  const orgBase = `/${params.tenant}/directory/organizations`;

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;
  const currentHolder = position.assignments.find((a) => a.isCurrent);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={base}>
            <ArrowLeft className="mr-1 size-4" />
            {t("actions.back")}
          </Link>
        </Button>
        <div className="flex gap-2">
          {canAssign ? (
            <Button asChild size="sm" variant="default">
              <Link to={`${base}/${position.id}/assign`}>
                <UserPlus className="mr-1 size-4" />
                {t("assignments.assignPerson")}
              </Link>
            </Button>
          ) : null}
          {canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`${base}/${position.id}/edit`}>
                <Pencil className="mr-1 size-4" />
                {t("actions.edit")}
              </Link>
            </Button>
          ) : null}
          {canDel ? (
            <Button asChild size="sm" variant="destructive">
              <Link to={`${base}/${position.id}/delete`}>
                <Trash2 className="mr-1 size-4" />
                {t("actions.delete")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{position.title}</h1>
          <Badge variant="secondary">{position.type.name}</Badge>
          {!position.isActive ? <Badge variant="outline">{t("status.inactive")}</Badge> : null}
          {pendingChange ? (
            <PendingBadge mine={pendingChange.submittedById === currentUserId} />
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          <Link to={`${orgBase}/${position.organization.id}`} className="hover:underline">
            {position.organization.name}
          </Link>
          {position.organization.acronym ? (
            <span className="ml-1">({position.organization.acronym})</span>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <UserCog className="size-4" />
                {t("positions.currentHolder")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentHolder ? (
                <div className="space-y-1">
                  <Link
                    to={`${peopleBase}/${currentHolder.person.id}`}
                    className="text-lg font-medium underline-offset-4 hover:underline"
                  >
                    {currentHolder.person.honorific ? `${currentHolder.person.honorific} ` : ""}
                    {currentHolder.person.firstName} {currentHolder.person.lastName}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {t("assignments.timelineFrom", {
                      date: formatDate(currentHolder.startDate),
                    })}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <UserX className="text-muted-foreground size-4" />
                  <span className="text-muted-foreground text-sm">
                    {t("positions.noCurrentHolder")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {position.description ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  {t("positions.fields.description")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{position.description}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4" />
                {t("positions.cards.holders")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentTimeline
                entries={position.assignments}
                mode="byPosition"
                basePrefix={peopleBase}
                endAction={(entry) =>
                  entry.isCurrent && canAssign ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`${base}/${position.id}/assignments/${entry.id}/end`}>
                        <UserX className="mr-1 size-3" />
                        {t("assignments.endAssignment")}
                      </Link>
                    </Button>
                  ) : null
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t("positions.cards.reporting")}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <InfoRow label={t("positions.fields.reportsTo")}>
                {position.reportsTo ? (
                  <Link to={`${base}/${position.reportsTo.id}`} className="hover:underline">
                    {position.reportsTo.title}
                  </Link>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label={t("positions.directReports")}>
                {position.reports.length > 0 ? position.reports.length.toString() : "—"}
              </InfoRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t("positions.cards.metadata")}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <InfoRow label={t("positions.fields.type")}>{position.type.name}</InfoRow>
              <InfoRow label={t("positions.fields.organization")}>
                {position.organization.name}
              </InfoRow>
              <InfoRow label={t("positions.fields.isActive")}>
                {position.isActive ? "✓" : "—"}
              </InfoRow>
              <InfoRow label={tc("updated")}>{formatDate(position.updatedAt)}</InfoRow>
            </CardContent>
          </Card>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
