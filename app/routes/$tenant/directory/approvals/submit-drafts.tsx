import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  ChangeRequestError,
  formatBatchSummary,
  submitDrafts,
} from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";

// POST-only resource route — the author's submissions list (and the draft
// detail page) post { ids[]: string[] } here to send drafts for review.
// Response carries the per-draft result plus a short summary
// ("3 submitted · 1 failed") for inline feedback.

export async function action({ request }: ActionFunctionArgs) {
  const { ctx } = await requireSubmitContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);

  try {
    const result = await submitDrafts(ids, ctx);
    return data({ result, summary: formatBatchSummary(result, "submitted") });
  } catch (error) {
    // Empty selection / over the batch cap.
    if (error instanceof ChangeRequestError) {
      return data({ result: null, summary: error.message }, { status: error.status });
    }
    throw error;
  }
}
