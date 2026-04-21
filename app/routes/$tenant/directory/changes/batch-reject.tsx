import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { formatBatchSummary, rejectChanges } from "~/services/directory-changes.server";
import { requireReviewContext } from "~/utils/directory-access.server";

export async function action({ request }: ActionFunctionArgs) {
  const { ctx } = await requireReviewContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);
  const notes = String(formData.get("notes") ?? "").trim();
  if (!notes) {
    return data({ error: "A reason is required for batch rejection" }, { status: 400 });
  }

  const result = await rejectChanges(ids, { notes }, ctx);
  return data({ result, summary: formatBatchSummary(result, "rejected") });
}
