import { Inbox, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, useFetcher } from "react-router";
import { useChangeColumns } from "~/components/directory/change-row-columns";
import { DataTable } from "~/components/data-table/data-table";
import type { FilterDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { Button } from "~/components/ui/button";
import { listMyChanges } from "~/services/directory-changes.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/submissions";

export const handle = { breadcrumb: "Submissions" };

const STATUS_VALUES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  if (!canSubmit) throw new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const status = url.searchParams.get("status") || "";
  const q = url.searchParams.get("q")?.trim() || "";

  const result = await listMyChanges(tenantId, user.id, {
    where: {
      ...(status ? { status } : {}),
      ...(q ? { search: q } : {}),
    },
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

export default function MyChanges({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { changes, pagination } = loaderData;
  const base = `/${params.tenant}/directory/approvals`;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const submitFetcher = useFetcher<{ summary: string }>();

  // Selection is page-local: clear it whenever the user paginates so a stale
  // id doesn't survive into the next submit.
  useEffect(() => {
    setSelectedIds([]);
  }, [pagination.page, pagination.pageSize]);

  // Only drafts can be submitted; other selected rows are left alone.
  const draftIds = changes
    .filter((c) => c.status === "DRAFT" && selectedIds.includes(c.id))
    .map((c) => c.id);

  const columns = useChangeColumns(base, [
    "entity",
    "operation",
    "status",
    "submittedAt",
    "reviewer",
  ]);

  const filters: FilterDef[] = [
    {
      paramKey: "status",
      label: t("changes.columns.status"),
      placeholder: t("changes.filters.allStatuses"),
      options: STATUS_VALUES.map((s) => ({
        label: t(`changes.statusLabel.${s}`),
        value: s,
      })),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("changes.mineTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("changes.mineSubtitle")}</p>
      </header>

      <DataTable
        data={changes}
        columns={columns}
        rowKey="id"
        selectable
        onSelectionChange={setSelectedIds}
        searchConfig={{ placeholder: t("changes.searchPlaceholder") }}
        filters={filters}
        toolbarExtra={
          draftIds.length > 0 ? (
            <submitFetcher.Form method="post" action={`${base}/submit-drafts`}>
              {draftIds.map((id) => (
                <input key={id} type="hidden" name="ids[]" value={id} />
              ))}
              <Button type="submit" size="sm" disabled={submitFetcher.state !== "idle"}>
                <Send className="mr-1 size-4" />
                {t("changes.actions.submitSelected", { count: draftIds.length })}
              </Button>
            </submitFetcher.Form>
          ) : null
        }
        pagination={pagination}
        emptyState={{
          icon: Inbox,
          title: t("changes.emptyMine"),
          description: t("changes.emptyMineDescription"),
        }}
      />

      {submitFetcher.data?.summary ? (
        <p role="status" className="text-sm">
          {submitFetcher.data.summary}
        </p>
      ) : null}
    </div>
  );
}
