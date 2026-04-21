import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { approveChanges, formatBatchSummary } from "~/services/directory-changes.server";
import { requireReviewContext } from "~/utils/directory-access.server";

// POST-only resource route — fetcher from the pending queue posts
// { ids[]: string[], notes?: string } here. Response carries a short
// summary ("5 approved · 1 skipped") for inline feedback.

export async function action({ request }: ActionFunctionArgs) {
  const { ctx } = await requireReviewContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);
  const notes = String(formData.get("notes") ?? "").trim() || undefined;

  const result = await approveChanges(ids, { notes }, ctx);
  return data({ result, summary: formatBatchSummary(result, "approved") });
}
