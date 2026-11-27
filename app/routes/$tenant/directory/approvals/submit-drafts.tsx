import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  ChangeRequestError,
  formatBatchSummary,
  submitDrafts,
} from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";
import { submissionsPath, type SubmittedConfirmation } from "~/utils/directory-routes";

// POST-only resource route — the author's submissions list (and the draft
// detail page) post { ids[]: string[] } here to send drafts for review.
// Response carries the per-draft result plus a short summary
// ("3 submitted · 1 failed") for inline feedback, and a `confirmation` when
// at least one draft actually went to review.

export async function action({ request, params }: ActionFunctionArgs) {
  const { ctx } = await requireSubmitContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);

  try {
    const result = await submitDrafts(ids, ctx);
    const confirmation: SubmittedConfirmation | null =
      result.succeeded.length > 0
        ? {
            count: result.succeeded.length,
            submissionsHref: submissionsPath(String(params.tenant)),
          }
        : null;
    return data({ result, summary: formatBatchSummary(result, "submitted"), confirmation });
  } catch (error) {
    // Empty selection / over the batch cap.
    if (error instanceof ChangeRequestError) {
      return data(
        { result: null, summary: error.message, confirmation: null },
        { status: error.status },
      );
    }
    throw error;
  }
}
