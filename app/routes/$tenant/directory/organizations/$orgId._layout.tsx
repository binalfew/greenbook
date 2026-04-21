import { ArrowLeft, Building2, Network, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import { PendingBadge } from "~/components/directory/pending-badge";
import { Badge } from "~/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { getOrganization, getOrganizationAncestry } from "~/services/organizations.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { formatDate } from "~/utils/format-date";
import type { Route } from "./+types/$orgId._layout";

export const handle = { breadcrumb: "Organization" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "organization",
  });
  const canWrite = canDirect;
  const canDelete = hasPermission(user, "organization", "delete");

  const [org, ancestry, pendingChange] = await Promise.all([
    getOrganization(params.orgId, tenantId),
    getOrganizationAncestry(params.orgId, tenantId),
    prisma.changeRequest.findFirst({
      where: {
        tenantId,
        status: "PENDING",
        entityType: "ORGANIZATION",
        entityId: params.orgId,
      },
      select: { id: true, submittedById: true, submittedAt: true },
    }),
  ]);

  return data({
    org,
    ancestry,
    pendingChange,
    canWrite,
    canDelete,
    canSubmit,
    currentUserId: user.id,
  });
}

export default function OrganizationDetailLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { org, ancestry, pendingChange, canWrite, canDelete, canSubmit, currentUserId } =
    loaderData;
  const base = `/${params.tenant}/directory/organizations`;

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;
  const crumbs = ancestry.slice(0, -1);

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
              <Link to={`${base}/${org.id}/edit`}>
                <Pencil className="mr-1 size-4" />
                {t("actions.edit")}
              </Link>
            </Button>
          ) : null}
          {canDel ? (
            <Button asChild size="sm" variant="destructive">
              <Link to={`${base}/${org.id}/delete`}>
                <Trash2 className="mr-1 size-4" />
                {t("actions.delete")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <header className="space-y-2">
        {crumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((a, idx) => (
                <BreadcrumbItem key={a.id}>
                  <BreadcrumbLink asChild>
                    <Link to={`${base}/${a.id}`}>{a.acronym || a.name}</Link>
                  </BreadcrumbLink>
                  {idx < crumbs.length - 1 ? <BreadcrumbSeparator /> : null}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          {org.acronym ? <Badge variant="outline">{org.acronym}</Badge> : null}
          <Badge variant="secondary">{org.type.name}</Badge>
          {!org.isActive ? <Badge variant="outline">{t("status.inactive")}</Badge> : null}
          {pendingChange ? (
            <PendingBadge mine={pendingChange.submittedById === currentUserId} />
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t("organizations.cards.basics")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {org.description ? (
                <section>
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    {t("organizations.fields.description")}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap">{org.description}</p>
                </section>
              ) : null}
              {org.mandate ? (
                <section>
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    {t("organizations.fields.mandate")}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap">{org.mandate}</p>
                </section>
              ) : null}
              {!org.description && !org.mandate ? (
                <p className="text-muted-foreground text-sm">—</p>
              ) : null}
            </CardContent>
          </Card>

          {org.children.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Network className="size-4" />
                  {t("kpi.organizations")} ({org._count.children})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {org.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                      <Link to={`${base}/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                      {c.acronym ? (
                        <span className="text-muted-foreground text-xs">{c.acronym}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {org.positions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="size-4" />
                  {t("kpi.positions")} ({org._count.positions})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {org.positions.map((p) => (
                    <li key={p.id} className="py-2 text-sm">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-muted-foreground text-xs">{p.type.name}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t("organizations.cards.metadata")}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <InfoRow label={t("organizations.fields.type")}>{org.type.name}</InfoRow>
              <InfoRow label={t("organizations.fields.parent")}>{org.parent?.name ?? "—"}</InfoRow>
              <InfoRow label={t("organizations.fields.establishmentDate")}>
                {formatDate(org.establishmentDate)}
              </InfoRow>
              <InfoRow label={t("organizations.fields.isActive")}>
                {org.isActive ? "✓" : "—"}
              </InfoRow>
              <InfoRow label={tc("updated")}>{formatDate(org.updatedAt)}</InfoRow>
            </CardContent>
          </Card>

          {org.website || org.email || org.phone || org.address ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  {t("organizations.cards.contact")}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {org.website ? (
                  <InfoRow label={t("organizations.fields.website")}>
                    <a
                      href={org.website}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {org.website}
                    </a>
                  </InfoRow>
                ) : null}
                {org.email ? (
                  <InfoRow label={t("organizations.fields.email")}>{org.email}</InfoRow>
                ) : null}
                {org.phone ? (
                  <InfoRow label={t("organizations.fields.phone")}>{org.phone}</InfoRow>
                ) : null}
                {org.address ? (
                  <InfoRow label={t("organizations.fields.address")}>{org.address}</InfoRow>
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
