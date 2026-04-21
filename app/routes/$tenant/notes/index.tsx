import { FileText, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type {
  ColumnDef,
  FilterDef,
  PaginationMeta,
} from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listCategories, listNotes } from "~/services/notes.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import { noteStatusValues } from "~/utils/schemas/notes";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Notes" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status") || "";
  const categoryId = url.searchParams.get("categoryId") || "";

  const [result, categories] = await Promise.all([
    listNotes(tenantId, {
      where: {
        ...(q ? { search: q } : {}),
        ...(status ? { status } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      page,
      pageSize,
    }),
    listCategories(tenantId),
  ]);

  const totalPages = Math.ceil(result.total / pageSize);

  return data({
    notes: result.data,
    categories,
    pagination: { page, pageSize, totalCount: result.total, totalPages } satisfies PaginationMeta,
  });
}

type NoteRow = Route.ComponentProps["loaderData"]["notes"][number];

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "\u2014";
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString();
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  DRAFT: "secondary",
  PUBLISHED: "default",
  ARCHIVED: "outline",
};

export default function NotesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const { t: tc } = useTranslation("common");
  const { notes, categories, pagination } = loaderData;
  const base = `/${params.tenant}/notes`;

  const columns: ColumnDef<NoteRow>[] = [
    {
      id: "title",
      header: t("title"),
      cell: (row) => (
        <div className="min-w-0">
          <Link to={`${base}/${row.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.title}
          </Link>
          {row.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[10px]">
                  {tag}
                </Badge>
              ))}
              {row.tags.length > 3 && (
                <span className="text-muted-foreground text-[10px]">+{row.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: t("status"),
      cell: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>
          {t(`statuses.${row.status}`)}
        </Badge>
      ),
    },
    {
      id: "category",
      header: t("category"),
      cell: (row) => (row.category ? row.category.name : "\u2014"),
      hideOnMobile: true,
    },
    {
      id: "author",
      header: t("author"),
      cell: (row) => {
        const name = `${row.author.firstName} ${row.author.lastName}`.trim();
        return name || row.author.email;
      },
      hideOnMobile: true,
    },
    {
      id: "comments",
      header: t("comments"),
      cell: (row) =>
        row._count.comments > 0 ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <MessageCircle className="size-3" />
            {row._count.comments}
          </span>
        ) : (
          "\u2014"
        ),
      hideOnMobile: true,
    },
    {
      id: "dueDate",
      header: t("dueDate"),
      cell: (row) => formatDate(row.dueDate),
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
    {
      id: "updatedAt",
      header: t("updatedAt"),
      cell: (row) => formatDate(row.updatedAt),
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "status",
      label: t("status"),
      placeholder: t("allStatuses"),
      options: noteStatusValues.map((s) => ({ label: t(`statuses.${s}`), value: s })),
    },
    {
      paramKey: "categoryId",
      label: t("category"),
      placeholder: t("allCategories"),
      options: categories.map((c) => ({ label: c.name, value: c.id })),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title_plural")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <DataTable
        data={notes}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: t("searchPlaceholder") }}
        filters={filters}
        toolbarActions={[
          {
            label: t("new"),
            icon: Plus,
            href: `${base}/new`,
          },
        ]}
        rowActions={[
          {
            label: tc("edit"),
            icon: Pencil,
            href: (row) => `${base}/${row.id}/edit`,
          },
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row) => `${base}/${row.id}/delete`,
            variant: "destructive",
          },
        ]}
        pagination={pagination}
        emptyState={{
          icon: FileText,
          title: t("emptyTitle"),
          description: t("emptyDescription"),
        }}
      />
    </div>
  );
}
