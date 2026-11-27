import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { SubmittedConfirmation } from "~/utils/directory-routes";

// Shown to the author once their drafts have gone to a manager: the
// `confirmation` the submit-drafts action returns. Managers publish directly
// and never get one.

export function SubmittedNotice({ confirmation }: { confirmation?: SubmittedConfirmation | null }) {
  const { t } = useTranslation("directory");
  if (!confirmation) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm"
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <div>
        <p className="font-medium">{t("changes.submitted.title", { count: confirmation.count })}</p>
        <p className="text-muted-foreground">
          {t("changes.submitted.description")}{" "}
          <Link to={confirmation.submissionsHref} className="text-foreground underline">
            {t("changes.submitted.link")}
          </Link>
        </p>
      </div>
    </div>
  );
}
