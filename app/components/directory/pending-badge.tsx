import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui/badge";

// Amber status pill shown on every directory entity that has a PENDING
// change request. `mine` signals the current user is the submitter (common
// UX: "your edit is in review") — otherwise it's someone else's submission
// and the current user is told to stop editing.

export function PendingBadge({ mine }: { mine: boolean }) {
  const { t } = useTranslation("directory");
  return (
    <Badge
      variant="default"
      className="border-transparent bg-amber-600 text-white hover:bg-amber-600"
    >
      {mine ? t("status.pendingYours") : t("status.pendingOther")}
    </Badge>
  );
}
