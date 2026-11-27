import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { rejectChanges } from "~/services/directory-changes.server";
import { requireRejectContext } from "~/utils/directory-access.server";
import { directoryMessages, runDirectoryBatch } from "~/utils/directory-submit.server";

// POST-only resource route — the pending queue's reject dialog posts
// { ids[]: string[], notes: string } here. Same response as batch approve.

export async function action({ request }: ActionFunctionArgs) {
  const { ctx } = await requireRejectContext(request);
  const formData = await request.formData();
  const ids = formData.getAll("ids[]").map(String);
  const notes = String(formData.get("notes") ?? "").trim();
  if (!notes) {
    const error = directoryMessages(request).changes.rejectDialog.reasonRequired;
    return data({ result: null, error }, { status: 400 });
  }

  const { status, ...outcome } = await runDirectoryBatch(request, () =>
    rejectChanges(ids, { notes }, ctx),
  );
  return data(outcome, { status });
}
