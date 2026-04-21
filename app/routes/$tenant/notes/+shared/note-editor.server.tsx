import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { createNote, updateNote } from "~/services/notes.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { noteFormSchema } from "~/utils/schemas/notes";

// Shared upsert action for new.tsx + $noteId_.edit.tsx. Branching happens on
// the presence of an `id` field in the payload (encoded as a hidden input in
// the editor). Domain checks (category must belong to tenant) run as async
// `superRefine` so they surface as inline form errors.

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;

  const user = await requirePermission(request, "note", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const submission = await parseWithZod(formData, {
    schema: noteFormSchema.superRefine(async (input, ctx) => {
      if (input.categoryId) {
        const exists = await prisma.noteCategory.findFirst({
          where: { id: input.categoryId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          ctx.addIssue({
            path: ["categoryId"],
            code: "custom",
            message: "Selected category does not exist in this tenant",
          });
        }
      }
    }),
    async: true,
  });

  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  const note = hasId
    ? await updateNote(submission.value.id as string, submission.value, ctx)
    : await createNote(submission.value, ctx);

  const redirectTo = new URL(request.url).searchParams.get("redirectTo");
  return redirect(redirectTo || `/${params.tenant}/notes/${note.id}`);
}
