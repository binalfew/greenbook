import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { submitDrafts } from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";
import { submissionsPath, type SubmittedConfirmation } from "~/utils/directory-routes";
import { runDirectoryBatch } from "~/utils/directory-submit.server";

// POST-only resource route — the author's submissions list (and the draft
// detail page) post { ids[]: string[] } here to send drafts for review.
// The response says which drafts were submitted, skipped or failed, and
// carries a `confirmation` when at least one draft actually went to review.

export async function action({ request, params }: ActionFunctionArgs) {
  const { ctx } = await requireSubmitContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);

  const { status, ...outcome } = await runDirectoryBatch(request, () => submitDrafts(ids, ctx));
  const submitted = outcome.result?.succeeded.length ?? 0;
  const confirmation: SubmittedConfirmation | null =
    submitted > 0
      ? { count: submitted, submissionsHref: submissionsPath(String(params.tenant)) }
      : null;
  return data({ ...outcome, confirmation }, { status });
}
