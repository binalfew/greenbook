import { ArrowLeft, Briefcase, Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import { AssignmentTimeline } from "~/components/directory/assignment-timeline";
import { PendingBadge } from "~/components/directory/pending-badge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { getPerson } from "~/services/people.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { formatDate } from "~/utils/format-date";
import type { Route } from "./+types/$personId._layout";

export const handle = { breadcrumb: "Person" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "person",
  });
  const canWrite = canDirect;
  const canDelete = hasPermission(user, "person", "delete");

  const [person, pendingChange] = await Promise.all([
    getPerson(params.personId, tenantId),
    prisma.changeRequest.findFirst({
      where: {
        tenantId,
        status: "PENDING",
        entityType: "PERSON",
        entityId: params.personId,
      },
      select: { id: true, submittedById: true },
    }),
  ]);

  return data({
    person,
    pendingChange,
    canWrite,
    canDelete,
    canSubmit,
    currentUserId: user.id,
  });
}

export default function PersonDetailLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { person, pendingChange, canWrite, canDelete, canSubmit, currentUserId } = loaderData;
  const base = `/${params.tenant}/directory/people`;
  const positionsBase = `/${params.tenant}/directory/positions`;

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;
  const fullName =
    `${person.honorific ? `${person.honorific} ` : ""}${person.firstName} ${person.lastName}`.trim();
  const currentAssignments = person.assignments.filter((a) => a.isCurrent);
  const historicalAssignments = person.assignments;

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
          {canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`${base}/${person.id}/edit`}>
                <Pencil className="mr-1 size-4" />
                {t("actions.edit")}
              </Link>
            </Button>
          ) : null}
          {canDel ? (
            <Button asChild size="sm" variant="destructive">
              <Link to={`${base}/${person.id}/delete`}>
                <Trash2 className="mr-1 size-4" />
                {t("actions.delete")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          {person.memberState ? (
            <Badge variant="outline">{person.memberState.abbreviation}</Badge>
          ) : null}
          {pendingChange ? (
            <PendingBadge mine={pendingChange.submittedById === currentUserId} />
          ) : null}
        </div>
        {currentAssignments[0] ? (
          <p className="text-muted-foreground text-sm">
            {currentAssignments[0].position.title}
            <span className="mx-1">·</span>
            {currentAssignments[0].position.organization.acronym ||
              currentAssignments[0].position.organization.name}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("people.noCurrentAssignments")}</p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {person.bio ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">{t("people.fields.bio")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{person.bio}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Briefcase className="size-4" />
                {t("people.cards.assignments")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentTimeline
                entries={historicalAssignments}
                mode="byPerson"
                basePrefix={positionsBase}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("people.cards.metadata")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {person.memberState ? (
                <InfoRow label={t("people.fields.memberState")}>
                  {person.memberState.fullName}
                </InfoRow>
              ) : null}
              {person.languages.length > 0 ? (
                <InfoRow label={t("people.fields.languages")}>
                  {person.languages.join(", ").toUpperCase()}
                </InfoRow>
              ) : null}
              <InfoRow label={tc("updated")}>{formatDate(person.updatedAt)}</InfoRow>
            </CardContent>
          </Card>

          {person.email || person.phone ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">{t("people.cards.contact")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {person.email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="text-muted-foreground size-4 shrink-0" />
                    <a href={`mailto:${person.email}`} className="hover:underline">
                      {person.email}
                    </a>
                    {!person.showEmail ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {t("people.visibility.contactPrivate")}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
                {person.phone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="text-muted-foreground size-4 shrink-0" />
                    <span>{person.phone}</span>
                    {!person.showPhone ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {t("people.visibility.contactPrivate")}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Outlet />
    </div>
  );
}
