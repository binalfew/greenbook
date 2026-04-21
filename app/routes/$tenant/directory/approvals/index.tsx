import { ListChecks, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, redirect, useFetcher } from "react-router";
import { useChangeColumns } from "~/components/directory/change-row-columns";
import { DataTable } from "~/components/data-table/data-table";
import type { FilterDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { listPendingChanges } from "~/services/directory-changes.server";
import { directoryEntityValues } from "~/utils/schemas/directory";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Pending" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId, canReview, canSubmit } = await requireDirectoryAccess(request);
  if (!canReview) {
    // Focal-person-only users land on the "my submissions" view.
    if (canSubmit) return redirect(`/${params.tenant}/directory/approvals/mine`);
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const entityType = url.searchParams.get("entityType") || "";

  const result = await listPendingChanges(tenantId, {
    where: { ...(entityType ? { entityType } : {}) },
    page,
    pageSize,
  });

  return data({
    changes: result.data,
    pagination: {
      page,
      pageSize,
      totalCount: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    } satisfies PaginationMeta,
  });
}

export default function PendingChangesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { changes, pagination } = loaderData;
  const base = `/${params.tenant}/directory/approvals`;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const approveFetcher = useFetcher<{ summary: string }>();
  const rejectFetcher = useFetcher<{ summary: string }>();

  // Selection is page-local: clear it whenever the user paginates or
  // changes filters so a stale id doesn't survive into the next batch.
  useEffect(() => {
    setSelectedIds([]);
  }, [pagination.page, pagination.pageSize]);

  // Close the reject dialog + reset notes once the server action finishes.
  useEffect(() => {
    if (rejectFetcher.state === "idle" && rejectFetcher.data?.summary) {
      setRejectOpen(false);
      setRejectNotes("");
    }
  }, [rejectFetcher.state, rejectFetcher.data]);

  const columns = useChangeColumns(base, ["entity", "operation", "submitter", "submittedAt"]);

  const filters: FilterDef[] = [
    {
      paramKey: "entityType",
      label: t("changes.columns.entity"),
      placeholder: t("changes.filters.allEntities"),
      options: directoryEntityValues.map((e) => ({
        label: t(`changes.entityLabel.${e}`),
        value: e,
      })),
    },
  ];

  const hasSelection = selectedIds.length > 0;
  const isBusy = approveFetcher.state !== "idle" || rejectFetcher.state !== "idle";

  function submitBatchReject() {
    const formData = new FormData();
    for (const id of selectedIds) formData.append("ids[]", id);
    formData.set("notes", rejectNotes);
    rejectFetcher.submit(formData, { method: "post", action: `${base}/batch-reject` });
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("changes.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("changes.subtitle")}</p>
      </header>

      <DataTable
        data={changes}
        columns={columns}
        rowKey="id"
        selectable
        onSelectionChange={setSelectedIds}
        filters={filters}
        toolbarExtra={
          hasSelection ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">{selectedIds.length} selected</span>
              <approveFetcher.Form method="post" action={`${base}/batch-approve`}>
                {selectedIds.map((id) => (
                  <input key={id} type="hidden" name="ids[]" value={id} />
                ))}
                <Button type="submit" size="sm" disabled={isBusy}>
                  {t("changes.actions.batchApprove")}
                </Button>
              </approveFetcher.Form>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isBusy}
                onClick={() => setRejectOpen(true)}
              >
                {t("changes.actions.batchReject")}
              </Button>
            </div>
          ) : null
        }
        pagination={pagination}
        emptyState={{
          icon: ListChecks,
          title: t("changes.emptyPending"),
          description: t("changes.emptyPendingDescription"),
        }}
      />

      {approveFetcher.data?.summary ? (
        <p className="text-sm">{approveFetcher.data.summary}</p>
      ) : null}
      {rejectFetcher.data?.summary ? <p className="text-sm">{rejectFetcher.data.summary}</p> : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="text-destructive size-5" />
              {t("changes.rejectDialog.title")}
            </DialogTitle>
            <DialogDescription>{t("changes.rejectDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted rounded-md px-3 py-2 text-sm">
              {selectedIds.length} selected
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-reject-notes">{t("changes.rejectDialog.notesLabel")}</Label>
              <Textarea
                id="batch-reject-notes"
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={isBusy}
              >
                {tc("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isBusy || rejectNotes.trim().length === 0}
                onClick={submitBatchReject}
              >
                {t("changes.rejectDialog.confirm")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
