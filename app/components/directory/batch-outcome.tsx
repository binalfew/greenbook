import { useTranslation } from "react-i18next";
import { FormError } from "~/components/directory/form-error";
import type { DirectoryBatchOutcome } from "~/utils/directory-submit.server";

// What a batch action (approve, reject, submit drafts) answered: how many
// changes went through, how many were skipped, and why each of the others
// failed. Submitted drafts are announced by `SubmittedNotice`, so "submitted"
// only reports what did not go through.

type Props = {
  verb: "approved" | "rejected" | "submitted";
  outcome?: { result: DirectoryBatchOutcome | null; error: string | null } | null;
};

export function BatchOutcome({ verb, outcome }: Props) {
  const { t } = useTranslation("directory");
  if (!outcome) return null;
  if (!outcome.result) return <FormError message={outcome.error} />;

  const { succeeded, skipped, failed } = outcome.result;
  const skippedKey = verb === "submitted" ? "skippedDrafts" : "skipped";
  const counts = [
    verb !== "submitted" && succeeded.length > 0
      ? t(`changes.batchSummary.${verb}`, { count: succeeded.length })
      : null,
    skipped.length > 0 ? t(`changes.batchSummary.${skippedKey}`, { count: skipped.length }) : null,
    failed.length > 0 ? t("changes.batchSummary.failed", { count: failed.length }) : null,
  ].filter((line) => line !== null);
  if (counts.length === 0) return null;

  // The same reason is listed once, however many changes failed for it.
  const reasons = [...new Set(failed.map((f) => f.message))];

  return (
    <div role="status" className="space-y-2 text-sm">
      <p>{counts.join(" ")}</p>
      {reasons.map((reason) => (
        <FormError key={reason} message={reason} />
      ))}
    </div>
  );
}
