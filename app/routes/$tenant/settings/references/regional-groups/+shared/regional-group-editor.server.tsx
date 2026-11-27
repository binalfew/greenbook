import { parseWithZod } from "@conform-to/zod/v4";
import { data, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import {
  createRegionalGroup,
  updateRegionalGroup,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requireReferenceDataAdmin } from "~/utils/reference-data-access.server";
import { regionalGroupFormSchema } from "./regional-group-schema";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;

  await requireReferenceDataAdmin(request);

  const submission = parseWithZod(formData, { schema: regionalGroupFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const input = {
    code: submission.value.code,
    name: submission.value.name,
    description: submission.value.description ?? null,
  };

  try {
    if (hasId && submission.value.id) {
      await updateRegionalGroup(submission.value.id, input);
    } else {
      await createRegionalGroup(input);
    }
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      if (err.code === "DUPLICATE_CODE") {
        return data(submission.reply({ fieldErrors: { code: [err.message] } }), {
          status: err.status,
        });
      }
      return data(submission.reply({ formErrors: [err.message] }), { status: err.status });
    }
    throw err;
  }

  return redirect(`/${params.tenant}/settings/references/regional-groups`);
}
