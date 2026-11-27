import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { CONFIRM_DUPLICATES_FIELD } from "~/components/directory/possible-duplicates";
import enDirectory from "~/locales/en/directory.json";
import frDirectory from "~/locales/fr/directory.json";
import { findPossibleDuplicatePeople } from "~/services/person-duplicates.server";
import {
  PhotoUploadError,
  keepablePhotoId,
  releaseUnreferencedPhotos,
  storePersonPhoto,
} from "~/services/person-photos.server";
import { PERSON_PHOTO_MAX_BYTES } from "~/utils/constants/person-photo";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { DRAFT_PARAM, draftsPath } from "~/utils/directory-routes";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { personFormSchema } from "~/utils/schemas/directory";

const PHOTO_ERRORS = { en: enDirectory.people.photo.errors, fr: frDirectory.people.photo.errors };

export async function action({ request, params }: ActionFunctionArgs) {
  // Checked before the body is read, so only editors can send an upload.
  const { user, tenantId } = await requireDirectoryWriteAccess(request, "person");
  const photoErrors = PHOTO_ERRORS[getLangFromRequest(request) ?? "en"];

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
  if (photo) {
    try {
      uploadedPhotoId = await storePersonPhoto(photo, { tenantId, userId: user.id });
    } catch (err) {
      if (!(err instanceof PhotoUploadError)) throw err;
      return data(submission.reply({ fieldErrors: { photo: [photoErrors[err.code]] } }), {
        status: 400,
      });
    }
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

  const base = `/${params.tenant}/directory/people`;
  if (outcome.mode === "SELF_APPROVED" && outcome.change.entityId) {
    return redirect(`${base}/${outcome.change.entityId}`);
  }
  if (outcome.mode === "DRAFT") return redirect(draftsPath(String(params.tenant)));
  return redirect(`${base}?submitted=1`);
}
