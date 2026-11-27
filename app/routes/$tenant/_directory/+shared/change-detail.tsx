import {
  ArrowLeft,
  Check,
  ExternalLink,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useFetcher } from "react-router";
import { BatchOutcome } from "~/components/directory/batch-outcome";
import { ChangeDiff } from "~/components/directory/change-diff";
import { ChangeStatusPill } from "~/components/directory/change-status-pill";
import { PossibleDuplicates } from "~/components/directory/possible-duplicates";
import { RejectionNotes } from "~/components/directory/rejection-notes";
import { SubmittedNotice } from "~/components/directory/submitted-notice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import {
  changePath,
  directoryEntitySegment,
  draftEditPath,
  submissionPath,
  submitDraftsPath,
} from "~/utils/directory-routes";
import { formatDate } from "~/utils/format-date";
import type { action as submitDraftsAction } from "../submissions/submit-drafts";
import type { ChangeDetailData } from "./change-detail.server";

// One change request, as its author sees it (`/submissions/<id>`) or as a
// reviewer does (`/approvals/<id>`). The two pages differ in their actions and
// in where Back leads; `detail.view` says which one this is.

export function ChangeDetail({ detail, tenant }: { detail: ChangeDetailData; tenant: string }) {
  const { t } = useTranslation("directory");
  const { change, diffs, subject, view, backHref, possibleDuplicates, canReopen, reopenedFrom } =
    detail;
  const isAuthor = view === "author";
  const base = isAuthor ? submissionPath(tenant, change.id) : changePath(tenant, change.id);
  const entitySegment = directoryEntitySegment(change.entityType);
  const entityHref = change.entityId ? `/${tenant}/${entitySegment}/${change.entityId}` : null;

  const isPending = change.status === "PENDING";
  // Drafts only ever open on the author's page.
  const isDraft = isAuthor && change.status === "DRAFT";
  const draftEditHref = isDraft ? draftEditPath(tenant, change) : null;
  const submitFetcher = useFetcher<typeof submitDraftsAction>();
  const submitterName =
    `${change.submittedBy.firstName} ${change.submittedBy.lastName}`.trim() ||
    change.submittedBy.email;
  const reviewerName = change.reviewedBy
    ? `${change.reviewedBy.firstName} ${change.reviewedBy.lastName}`.trim() ||
      change.reviewedBy.email
    : null;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{subject ?? t("changes.detailTitle")}</h1>
            <Badge variant="outline">{t(`changes.entityLabel.${change.entityType}`)}</Badge>
            <Badge variant="secondary">{t(`changes.operationLabel.${change.operation}`)}</Badge>
            <ChangeStatusPill status={change.status} />
            {change.approvalMode === "SELF_APPROVED" ? (
              <Badge variant="outline">{t("changes.selfApprovedTag")}</Badge>
            ) : null}
            {reopenedFrom ? (
              <Badge variant="outline">{t("changes.reopened.followsRejection")}</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={backHref}>
                <ArrowLeft className="mr-1 size-4" />
                {t("actions.back")}
              </Link>
            </Button>
            {entityHref ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={entityHref}>
                  <ExternalLink className="mr-1 size-4" />
                  {t("changes.actions.viewEntity")}
                </Link>
              </Button>
            ) : null}
            {isPending && !isAuthor ? (
              <>
                <Button asChild size="sm">
                  <Link to={`${base}/approve`}>
                    <Check className="mr-1 size-4" />
                    {t("changes.actions.approve")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="destructive">
                  <Link to={`${base}/reject`}>
                    <X className="mr-1 size-4" />
                    {t("changes.actions.reject")}
                  </Link>
                </Button>
              </>
            ) : null}
            {isPending && isAuthor ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`${base}/withdraw`}>
                  <Undo2 className="mr-1 size-4" />
                  {t("changes.actions.withdraw")}
                </Link>
              </Button>
            ) : null}
            {canReopen ? (
              <Button asChild size="sm">
                <Link to={`${base}/reopen`}>
                  <RotateCcw className="mr-1 size-4" />
                  {t("changes.actions.reopen")}
                </Link>
              </Button>
            ) : null}
            {isDraft ? (
              <>
                {draftEditHref ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to={draftEditHref}>
                      <Pencil className="mr-1 size-4" />
                      {t("changes.actions.editDraft")}
                    </Link>
                  </Button>
                ) : null}
                <Button asChild size="sm" variant="outline">
                  <Link to={`${base}/discard`}>
                    <Trash2 className="mr-1 size-4" />
                    {t("changes.actions.discard")}
                  </Link>
                </Button>
                <submitFetcher.Form method="post" action={submitDraftsPath(tenant)}>
                  <input type="hidden" name="ids[]" value={change.id} />
                  <Button type="submit" size="sm" disabled={submitFetcher.state !== "idle"}>
                    <Send className="mr-1 size-4" />
                    {t("changes.actions.submitDraft")}
                  </Button>
                </submitFetcher.Form>
              </>
            ) : null}
          </div>
        </div>
        {isAuthor ? null : (
          <p className="text-muted-foreground text-sm">{t("changes.detailSubtitle")}</p>
        )}
      </header>

      <SubmittedNotice confirmation={submitFetcher.data?.confirmation} />

      <BatchOutcome verb="submitted" outcome={submitFetcher.data} />

      <RejectionNotes rejection={reopenedFrom} tenant={tenant} view={view} />
      <PossibleDuplicates duplicates={possibleDuplicates} peopleHref={`/${tenant}/people`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ChangeDiff diffs={diffs} entityType={change.entityType} operation={change.operation} />

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
