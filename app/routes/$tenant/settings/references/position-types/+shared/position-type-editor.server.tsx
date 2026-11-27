import { parseWithZod } from "@conform-to/zod/v4";
import { data, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import {
  createPositionType,
  updatePositionType,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requireReferenceDataAdmin } from "~/utils/reference-data-access.server";
import { positionTypeFormSchema } from "./position-type-schema";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;

  await requireReferenceDataAdmin(request);

  const submission = parseWithZod(formData, { schema: positionTypeFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const input = {
    code: submission.value.code,
    name: submission.value.name,
    hierarchyLevel: submission.value.hierarchyLevel,
    description: submission.value.description ?? null,
  };

  try {
    if (hasId && submission.value.id) {
      await updatePositionType(submission.value.id, input);
    } else {
      await createPositionType(input);
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

  return redirect(`/${params.tenant}/settings/references/position-types`);
}
