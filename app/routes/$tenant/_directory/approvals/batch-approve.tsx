import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { approveChanges } from "~/services/directory-changes.server";
import { requireApproveContext } from "~/utils/directory-access.server";
import { runDirectoryBatch } from "~/utils/directory-submit.server";

// POST-only resource route — fetcher from the pending queue posts
// { ids[]: string[], notes?: string } here. The response says which changes
// were approved, skipped or failed; `BatchOutcome` renders it.

export async function action({ request }: ActionFunctionArgs) {
  const { ctx } = await requireApproveContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);
  const notes = String(formData.get("notes") ?? "").trim() || undefined;

  const { status, ...outcome } = await runDirectoryBatch(request, () =>
    approveChanges(ids, { notes }, ctx),
  );
  return data(outcome, { status });
}
