import { redirect } from "react-router";
import {
  ChangeRequestError,
  canReopenChange,
  computeDiff,
  describeChangeSubject,
  getChange,
  getReopenedFrom,
  toDraftRejection,
} from "~/services/directory-changes.server";
import {
  findPossibleDuplicatePeople,
  type DuplicateCandidate,
} from "~/services/person-duplicates.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { approvalsPath, submissionPath, submissionsPath } from "~/utils/directory-routes";

/** Whose page is being loaded: the author's submission or the reviewer's copy. */
export type ChangeDetailView = "author" | "reviewer";

export type ChangeDetailData = Awaited<ReturnType<typeof loadChangeDetail>>;

/**
 * Loads one change request for `/submissions/<id>` (view `author`) or
 * `/approvals/<id>` (view `reviewer`).
 *
 * The author's page shows only the user's own requests; anyone else's reads
 * as not-found. The reviewer's page needs review access, and sends an author
 * who landed there (an old link, or their own draft) to their submission.
 */
export async function loadChangeDetail(
  request: Request,
  params: { tenant: string; changeId: string },
  view: ChangeDetailView,
) {
  const { user, tenantId, canReview, canSubmit } = await requireDirectoryAccess(request);
  if (view === "author" ? !canSubmit : !canReview && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  // Someone else's draft reads as not-found, same as a missing id.
  const change = await getChange(params.changeId, tenantId, user.id).catch((error) => {
    if (error instanceof ChangeRequestError && error.code === "NOT_FOUND") {
      throw new Response("Not Found", { status: 404 });
    }
    throw error;
  });
  const isMine = change.submittedById === user.id;

  if (view === "author") {
    if (!isMine) throw new Response("Not Found", { status: 404 });
  } else {
    // A draft is never under review, and a user without review access has
    // no approvals pages: both belong on the author's page.
    if (isMine && (!canReview || change.status === "DRAFT")) {
      throw redirect(submissionPath(params.tenant, change.id));
    }
    if (!canReview) throw new Response("Forbidden", { status: 403 });
  }

  const [diffs, subject] = await Promise.all([computeDiff(change), describeChangeSubject(change)]);
  const backHref =
    view === "author" ? submissionsPath(params.tenant) : approvalsPath(params.tenant);
  // The advisory check the person editor runs on save, repeated here so a
  // reviewer sees it before approving. Only while the change is still open.
  const isOpenPersonChange =
    change.entityType === "PERSON" &&
    (change.operation === "CREATE" || change.operation === "UPDATE") &&
    (change.status === "DRAFT" || change.status === "PENDING");
  const possibleDuplicates = isOpenPersonChange
    ? await findPossibleDuplicatePeople(tenantId, change.payload as DuplicateCandidate, {
        personId: change.entityId,
        changeId: change.id,
      })
    : [];
  // A reopened request shows the rejection it follows; the author of a
  // rejected request may reopen it as a draft.
  const [rejected, canReopen] = await Promise.all([
    getReopenedFrom(change),
    view === "author" ? canReopenChange(change, user.id) : false,
  ]);
  const reopenedFrom = toDraftRejection(rejected);
  return {
    change,
    diffs,
    subject,
    view,
    backHref,
    possibleDuplicates,
    canReopen,
    reopenedFrom,
  };
}
