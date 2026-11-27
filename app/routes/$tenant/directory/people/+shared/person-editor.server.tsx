import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { CONFIRM_DUPLICATES_FIELD } from "~/components/directory/possible-duplicates";
import { findPossibleDuplicatePeople } from "~/services/person-duplicates.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { DRAFT_PARAM, draftsPath } from "~/utils/directory-routes";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { personFormSchema } from "~/utils/schemas/directory";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, {
    schema: personFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const { id, initialPositionId, initialStartDate, initialNotes, ...rest } = submission.value;
  const hasId = typeof id === "string" && id.length > 0;

  // Initial-assignment block is a CREATE-only convenience: on UPDATE we drop
  // the fields to avoid leaking them into an update payload.
  const initialAssignment =
    !hasId && initialPositionId && initialPositionId.length > 0
      ? {
          positionId: initialPositionId,
          startDate:
            initialStartDate && initialStartDate.length > 0
              ? initialStartDate
              : new Date().toISOString().slice(0, 10),
          notes: initialNotes && initialNotes.length > 0 ? initialNotes : null,
        }
      : undefined;

  const payload = initialAssignment ? { ...rest, initialAssignment } : rest;

  // Possible duplicates are a warning, not an error: the first save comes
  // back with the matches, and the editor's "save anyway" button re-posts
  // with the confirmation field to go through.
  if (!formData.has(CONFIRM_DUPLICATES_FIELD)) {
    const { tenantId } = await requireDirectoryWriteAccess(request, "person");
    const duplicates = await findPossibleDuplicatePeople(tenantId, rest, {
      personId: hasId ? id : undefined,
      changeId: new URL(request.url).searchParams.get(DRAFT_PARAM),
    });
    if (duplicates.length > 0) return data({ ...submission.reply(), duplicates });
  }

  const outcome = await dispatchDirectoryChange(request, "person", {
    entityType: "PERSON",
    operation: hasId ? "UPDATE" : "CREATE",
    entityId: hasId ? id : undefined,
    payload,
  });
  if (outcome.conflict) {
    return data(submission.reply({ formErrors: [outcome.conflict.message] }), { status: 409 });
  }

  const base = `/${params.tenant}/directory/people`;
  if (outcome.mode === "SELF_APPROVED" && outcome.change.entityId) {
    return redirect(`${base}/${outcome.change.entityId}`);
  }
  if (outcome.mode === "DRAFT") return redirect(draftsPath(String(params.tenant)));
  return redirect(`${base}?submitted=1`);
}
