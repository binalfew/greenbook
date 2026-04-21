import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getNote, listCategories } from "~/services/notes.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { NoteEditor } from "../+shared/note-editor";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

// Trailing-underscore folder = escapes the detail layout, so the editor
// renders as a full page (2/3 layout would be awkward for a form).
export { action } from "../+shared/note-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  await requirePermission(request, "note", "write");

  const [note, categories] = await Promise.all([
    getNote(params.noteId, tenantId),
    listCategories(tenantId),
  ]);

  return data({ note, categories });
}

export default function EditNote({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const base = `/${params.tenant}/notes`;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("edit")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.note.title}</p>
      </header>
      <NoteEditor
        note={{
          id: loaderData.note.id,
          title: loaderData.note.title,
          content: loaderData.note.content,
          status: loaderData.note.status,
          categoryId: loaderData.note.categoryId,
          tags: loaderData.note.tags,
          dueDate: loaderData.note.dueDate,
        }}
        categories={loaderData.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        actionData={actionData}
        basePrefix={base}
      />
    </div>
  );
}
