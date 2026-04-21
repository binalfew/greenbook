import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
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

  // SELF_APPROVED lands on the entity; REVIEWED sends the user to the list
  // with a ?submitted=1 banner since the entity doesn't exist yet.
  const base = `/${params.tenant}/directory/organizations`;
  if (outcome.mode === "SELF_APPROVED" && outcome.change.entityId) {
    return redirect(`${base}/${outcome.change.entityId}`);
  }
  return redirect(`${base}?submitted=1`);
}
