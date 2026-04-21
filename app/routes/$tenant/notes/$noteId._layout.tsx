import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getNote } from "~/services/notes.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/$noteId._layout";

export const handle = { breadcrumb: "Note" };

// 2/3 + 1/3 detail layout. Left: content + comments (sub-entity Outlet
// renders dialog overlays here). Right: metadata.
// See CLAUDE.md "Detail Page Layout" for the pattern.

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  const note = await getNote(params.noteId, tenantId);
  return data({ note });
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "\u2014";
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString();
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium break-words">{children}</span>
    </div>
  );
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  DRAFT: "secondary",
  PUBLISHED: "default",
  ARCHIVED: "outline",
};

export default function NoteLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const { t: tc } = useTranslation("common");
  const { note } = loaderData;
  const base = `/${params.tenant}/notes`;

  const authorName = `${note.author.firstName} ${note.author.lastName}`.trim() || note.author.email;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-foreground truncate text-2xl font-bold">{note.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANTS[note.status] ?? "secondary"}>
              {t(`statuses.${note.status}`)}
            </Badge>
            {note.category && <Badge variant="outline">{note.category.name}</Badge>}
            {note.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link to={base}>
              <ArrowLeft className="mr-1.5 size-3.5" />
              {tc("back")}
            </Link>
          </Button>
          <Button size="sm" asChild className="w-full sm:w-auto">
            <Link to={`${base}/${note.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              {tc("edit")}
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild className="w-full sm:w-auto">
            <Link to={`${base}/${note.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              {tc("delete")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("content")}</CardTitle>
            </CardHeader>
            <CardContent>
              {note.content ? (
                <pre className="text-foreground font-sans text-sm whitespace-pre-wrap">
                  {note.content}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm italic">{t("emptyContent")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                {t("commentsCount", { count: note.comments.length })}
              </CardTitle>
              <Button size="sm" variant="outline" asChild>
                <Link to={`${base}/${note.id}/comments/new`}>{t("addComment")}</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {note.comments.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">{t("noComments")}</p>
              ) : (
                note.comments.map((comment) => {
                  const cname =
                    `${comment.author.firstName} ${comment.author.lastName}`.trim() ||
                    comment.author.email;
                  return (
                    <div
                      key={comment.id}
                      className="border-muted group flex items-start justify-between gap-3 border-l-2 pl-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground text-sm whitespace-pre-wrap">
                          {comment.body}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {cname} · {formatDate(comment.createdAt)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        asChild
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Link
                          to={`${base}/${note.id}/comments/${comment.id}/delete`}
                          className="text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </Link>
                      </Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("details")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y py-2">
              <InfoRow label={t("status")}>
                <Badge variant={STATUS_VARIANTS[note.status] ?? "secondary"}>
                  {t(`statuses.${note.status}`)}
                </Badge>
              </InfoRow>
              <InfoRow label={t("category")}>
                {note.category ? note.category.name : "\u2014"}
              </InfoRow>
              <InfoRow label={t("author")}>{authorName}</InfoRow>
              <InfoRow label={t("dueDate")}>
                {note.dueDate ? new Date(note.dueDate).toLocaleDateString() : "\u2014"}
              </InfoRow>
              <InfoRow label={t("version")}>{note.version}</InfoRow>
              <InfoRow label={t("createdAt")}>{formatDate(note.createdAt)}</InfoRow>
              <InfoRow label={t("updatedAt")}>{formatDate(note.updatedAt)}</InfoRow>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog overlays (delete, comments.*) render here */}
      <Outlet />
    </div>
  );
}
