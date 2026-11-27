import type { SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { CONFIRM_DUPLICATES_FIELD } from "~/components/directory/possible-duplicates";
import {
  findPossibleDuplicatePeople,
  type PossibleDuplicate,
} from "~/services/person-duplicates.server";
import {
  PhotoUploadError,
  keepablePhotoId,
  preparePersonPhoto,
  releaseUnreferencedPhotos,
  storePersonPhoto,
} from "~/services/person-photos.server";
import { PERSON_PHOTO_MAX_BYTES } from "~/utils/constants/person-photo";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { DRAFT_PARAM, draftsPath } from "~/utils/directory-routes";
import { directoryMessages, dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { personFormSchema } from "~/utils/schemas/directory";

/** What the editor gets back when a save does not go through. */
export type PersonEditorResult = SubmissionResult<string[]> & {
  /** Present when the save was held back with a duplicate warning. */
  duplicates?: PossibleDuplicate[];
};

export async function action({ request, params }: ActionFunctionArgs) {
  // Checked before the body is read, so only editors can send an upload.
  const { user, tenantId } = await requireDirectoryWriteAccess(request, "person");
  const photoErrors = directoryMessages(request).people.photo.errors;

  // Refuse an oversized request without buffering it. The form's other
  // fields are a few KB, so anything this far over the limit is the photo.
  if (Number(request.headers.get("content-length")) > PERSON_PHOTO_MAX_BYTES * 2) {
    return data(
      { status: "error" as const, error: { photo: [photoErrors.TOO_LARGE] } },
      { status: 400 },
    );
  }

  const formData = await request.formData();
  const submission = parseWithZod(formData, {
    schema: personFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const {
    id,
    initialPositionId,
    initialStartDate,
    initialNotes,
    photo,
    photoId: shownPhotoId,
    removePhoto,
    ...rest
  } = submission.value;
  const hasId = typeof id === "string" && id.length > 0;

  // A file that cannot be used is an error on the first save, whatever else
  // the save has to say.
  let preparedPhoto;
  try {
    preparedPhoto = photo ? await preparePersonPhoto(photo) : null;
  } catch (err) {
    if (!(err instanceof PhotoUploadError)) throw err;
    return data(submission.reply({ fieldErrors: { photo: [photoErrors[err.code]] } }), {
      status: 400,
    });
  }

  // Possible duplicates are a warning, not an error: the first save comes
  // back with the matches, and the editor's "save anyway" button re-posts
  // with the confirmation field to go through. Runs before the photo is
  // stored: the re-post carries the file again.
  if (!formData.has(CONFIRM_DUPLICATES_FIELD)) {
    const duplicates = await findPossibleDuplicatePeople(tenantId, rest, {
      personId: hasId ? id : undefined,
      changeId: new URL(request.url).searchParams.get(DRAFT_PARAM),
    });
    if (duplicates.length > 0) return data({ ...submission.reply(), duplicates });
  }

  // A new file wins, then an explicit removal; otherwise the photo stays.
  let photoId: string | null;
  let uploadedPhotoId: string | undefined;
  if (preparedPhoto) {
    uploadedPhotoId = await storePersonPhoto(preparedPhoto, { tenantId, userId: user.id });
    photoId = uploadedPhotoId;
  } else if (removePhoto) {
    photoId = null;
  } else {
    photoId = await keepablePhotoId(shownPhotoId, {
      tenantId,
      userId: user.id,
      personId: hasId ? id : undefined,
    });
  }

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

  const payload = initialAssignment
    ? { ...rest, photoId, initialAssignment }
    : { ...rest, photoId };

  let outcome;
  try {
    outcome = await dispatchDirectoryChange(request, "person", {
      entityType: "PERSON",
      operation: hasId ? "UPDATE" : "CREATE",
      entityId: hasId ? id : undefined,
      payload,
    });
  } finally {
    // If the save did not go through, the file just stored belongs to nothing.
    if (uploadedPhotoId) await releaseUnreferencedPhotos([uploadedPhotoId]);
  }
  if (outcome.conflict) {
    return data(submission.reply({ formErrors: [outcome.conflict.message] }), { status: 409 });
  }

  if (outcome.mode === "DRAFT") return redirect(draftsPath(String(params.tenant)));
  return redirect(`/${params.tenant}/people/${outcome.change.entityId}`);
}
