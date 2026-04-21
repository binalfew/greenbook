import { parseWithZod } from "@conform-to/zod/v4";
import { data, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import {
  createLanguage,
  updateLanguage,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { languageFormSchema } from "./language-schema";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;

  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const submission = parseWithZod(formData, { schema: languageFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  const input = {
    code: submission.value.code,
    name: submission.value.name,
    nativeName: submission.value.nativeName || null,
    sortOrder: submission.value.sortOrder,
    isActive: submission.value.isActive,
  };

  try {
    if (hasId && submission.value.id) {
      await updateLanguage(submission.value.id, input, ctx);
    } else {
      await createLanguage(input, ctx);
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

  return redirect(`/${params.tenant}/settings/references/languages`);
}
