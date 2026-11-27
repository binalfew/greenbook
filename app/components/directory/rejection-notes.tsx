import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { DraftRejection } from "~/services/directory-changes.server";
import { changePath } from "~/utils/directory-routes";

// Why an earlier request was rejected. Shown above an editor resuming a
// reopened draft (so the author fixes what was asked) and on the change
// detail page of the follow-up (so the reviewer can check the correction).

export function RejectionNotes({
  rejection,
  tenant,
}: {
  rejection?: DraftRejection | null;
  tenant: string;
}) {
  const { t } = useTranslation("directory");
  if (!rejection) return null;
  return (
    <aside className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-medium">
        {rejection.reviewerName
          ? t("changes.reopened.rejectedBy", { name: rejection.reviewerName })
          : t("changes.reopened.rejected")}
      </p>
      {rejection.notes ? <p className="mt-1 whitespace-pre-wrap">{rejection.notes}</p> : null}
      <Link
        to={changePath(tenant, rejection.changeId)}
        className="mt-2 inline-block underline underline-offset-2"
      >
        {t("changes.reopened.viewRejected")}
      </Link>
    </aside>
  );
}
