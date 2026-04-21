import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { listCategories } from "~/services/notes.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { NoteEditor } from "./+shared/note-editor";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New note" };

// Thin wrapper — loader fetches create-time context (categories for the
// SelectField), action re-exported from the shared editor-server.
export { action } from "./+shared/note-editor.server";

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  await requirePermission(request, "note", "write");
  const categories = await listCategories(tenantId);
  return data({ categories });
}

export default function NewNote({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const base = `/${params.tenant}/notes`;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
        <p className="text-muted-foreground text-sm">{t("newSubtitle")}</p>
      </header>
      <NoteEditor
        categories={loaderData.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        actionData={actionData}
        basePrefix={base}
      />
    </div>
  );
}
