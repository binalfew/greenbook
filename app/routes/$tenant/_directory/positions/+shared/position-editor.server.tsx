import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { draftsPath } from "~/utils/directory-routes";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { positionFormSchema } from "~/utils/schemas/directory";

export async function action({ request, params }: ActionFunctionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: positionFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const { id, ...payload } = submission.value;
  const hasId = typeof id === "string" && id.length > 0;

  const outcome = await dispatchDirectoryChange(request, "position", {
    entityType: "POSITION",
    operation: hasId ? "UPDATE" : "CREATE",
    entityId: hasId ? id : undefined,
    payload,
  });
  if (outcome.conflict) {
    return data(submission.reply({ formErrors: [outcome.conflict.message] }), { status: 409 });
  }

  if (outcome.mode === "DRAFT") return redirect(draftsPath(String(params.tenant)));
  return redirect(`/${params.tenant}/positions/${outcome.change.entityId}`);
}
