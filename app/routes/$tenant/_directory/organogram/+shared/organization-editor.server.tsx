import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { draftsPath } from "~/utils/directory-routes";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { organizationFormSchema } from "~/utils/schemas/directory";

export async function action({ request, params }: ActionFunctionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: organizationFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const { id, ...payload } = submission.value;
  const hasId = typeof id === "string" && id.length > 0;

  const outcome = await dispatchDirectoryChange(request, "organization", {
    entityType: "ORGANIZATION",
    operation: hasId ? "UPDATE" : "CREATE",
    entityId: hasId ? id : undefined,
    payload,
  });
  if (outcome.conflict) {
    return data(submission.reply({ formErrors: [outcome.conflict.message] }), { status: 409 });
  }

  // A saved draft sends the author to their drafts, where it can be submitted
  // alone or with others; a published change lands on the entity.
  if (outcome.mode === "DRAFT") return redirect(draftsPath(String(params.tenant)));
  return redirect(`/${params.tenant}/organogram/${outcome.change.entityId}`);
}
