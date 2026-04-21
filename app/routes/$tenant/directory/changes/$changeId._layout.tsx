import { ArrowLeft, Check, ExternalLink, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import { ChangeDiff } from "~/components/directory/change-diff";
import { ChangeStatusPill } from "~/components/directory/change-status-pill";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { computeDiff, getChange } from "~/services/directory-changes.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { directoryEntitySegment } from "~/utils/directory-routes";
import { formatDate } from "~/utils/format-date";
import type { Route } from "./+types/$changeId._layout";

export const handle = { breadcrumb: "Change" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canReview, canSubmit } = await requireDirectoryAccess(request);
  if (!canReview && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const change = await getChange(params.changeId, tenantId);

  // Users without review access should only see their own submissions.
  if (!canReview && change.submittedById !== user.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const diffs = await computeDiff(change);
  return data({ change, diffs, currentUserId: user.id, canReview });
}

export default function ChangeDetailLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { change, diffs, currentUserId, canReview } = loaderData;
  const base = `/${params.tenant}/directory/changes`;
  const entitySegment = directoryEntitySegment(change.entityType);
  const entityHref = change.entityId
    ? `/${params.tenant}/directory/${entitySegment}/${change.entityId}`
    : null;

  const isPending = change.status === "PENDING";
  const isMine = change.submittedById === currentUserId;
  const submitterName =
    `${change.submittedBy.firstName} ${change.submittedBy.lastName}`.trim() ||
    change.submittedBy.email;
  const reviewerName = change.reviewedBy
    ? `${change.reviewedBy.firstName} ${change.reviewedBy.lastName}`.trim() ||
      change.reviewedBy.email
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={isMine && !canReview ? `${base}/mine` : base}>
            <ArrowLeft className="mr-1 size-4" />
            {t("actions.back")}
          </Link>
        </Button>
        <div className="flex gap-2">
          {entityHref ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={entityHref}>
                <ExternalLink className="mr-1 size-4" />
                {t("changes.actions.viewEntity")}
              </Link>
            </Button>
          ) : null}
          {isPending && canReview ? (
            <>
              <Button asChild size="sm">
                <Link to={`${base}/${change.id}/approve`}>
                  <Check className="mr-1 size-4" />
                  {t("changes.actions.approve")}
                </Link>
              </Button>
              <Button asChild size="sm" variant="destructive">
                <Link to={`${base}/${change.id}/reject`}>
                  <X className="mr-1 size-4" />
                  {t("changes.actions.reject")}
                </Link>
              </Button>
            </>
          ) : null}
          {isPending && isMine ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`${base}/${change.id}/withdraw`}>
                <Undo2 className="mr-1 size-4" />
                {t("changes.actions.withdraw")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t("changes.detailTitle")}</h1>
          <Badge variant="outline">{t(`changes.entityLabel.${change.entityType}`)}</Badge>
          <Badge variant="secondary">{t(`changes.operationLabel.${change.operation}`)}</Badge>
          <ChangeStatusPill status={change.status} />
          {change.approvalMode === "SELF_APPROVED" ? (
            <Badge variant="outline">{t("changes.selfApprovedTag")}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">{t("changes.detailSubtitle")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t("changes.beforeAfter.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChangeDiff diffs={diffs} />
            </CardContent>
          </Card>

          {change.reviewerNotes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  {t("changes.columns.notes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{change.reviewerNotes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("changes.metadata")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <InfoRow label={t("changes.columns.submitter")}>
                <span>
                  {submitterName}
                  <br />
                  <span className="text-muted-foreground text-xs">
                    {formatDate(change.submittedAt)}
                  </span>
                </span>
              </InfoRow>
              {reviewerName ? (
                <InfoRow label={t("changes.columns.reviewer")}>
                  <span>
                    {reviewerName}
                    <br />
                    <span className="text-muted-foreground text-xs">
                      {change.reviewedAt ? formatDate(change.reviewedAt) : "—"}
                    </span>
                  </span>
                </InfoRow>
              ) : null}
              <InfoRow label={t("changes.approvalMode")}>
                {t(`changes.approvalModeLabel.${change.approvalMode}`)}
              </InfoRow>
              {change.failureReason ? (
                <InfoRow label={t("changes.columns.notes")}>
                  <span className="text-destructive text-xs">{change.failureReason}</span>
                </InfoRow>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
