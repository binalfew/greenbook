import { parseWithZod } from "@conform-to/zod/v4";
import { data, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import {
  createMemberState,
  updateMemberState,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { memberStateFormSchema } from "./member-state-schema";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;

  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  // Checkbox group: getAll to capture every selected region before Conform parse.
  const regionIds = formData.getAll("regionIds").filter((v): v is string => typeof v === "string");

  const submission = parseWithZod(formData, { schema: memberStateFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  const input = {
    fullName: submission.value.fullName,
    abbreviation: submission.value.abbreviation,
    dateJoined: submission.value.dateJoined,
    isActive: submission.value.isActive,
    predecessorOrg: submission.value.predecessorOrg,
    notes: submission.value.notes ?? null,
    regionIds,
  };

  try {
    if (hasId && submission.value.id) {
      await updateMemberState(submission.value.id, input, ctx);
    } else {
      await createMemberState(input, ctx);
    }
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      if (err.code === "DUPLICATE_CODE") {
        return data(submission.reply({ fieldErrors: { abbreviation: [err.message] } }), {
          status: err.status,
        });
      }
      return data(submission.reply({ formErrors: [err.message] }), { status: err.status });
    }
    throw err;
  }

  return redirect(`/${params.tenant}/settings/references/member-states`);
}
