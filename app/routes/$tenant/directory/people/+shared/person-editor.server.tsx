import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { personFormSchema } from "~/utils/schemas/directory";

export async function action({ request, params }: ActionFunctionArgs) {
  const submission = parseWithZod(await request.formData(), {
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

  const outcome = await dispatchDirectoryChange(request, "person", {
    entityType: "PERSON",
    operation: hasId ? "UPDATE" : "CREATE",
    entityId: hasId ? id : undefined,
    payload,
  });

  const base = `/${params.tenant}/directory/people`;
  if (outcome.mode === "SELF_APPROVED" && outcome.change.entityId) {
    return redirect(`${base}/${outcome.change.entityId}`);
  }
  return redirect(`${base}?submitted=1`);
}
