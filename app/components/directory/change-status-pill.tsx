import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui/badge";
import type { ChangeStatus } from "~/generated/prisma/client.js";

// Status pill for ChangeRequest rows across the Approvals queue, My
// Submissions, and History views. Pending uses the amber "attention"
// treatment that matches the entity-level pending badge.

const STATUS_CLASS: Record<ChangeStatus, string> = {
  PENDING: "border-transparent bg-amber-600 text-white hover:bg-amber-600",
  APPROVED: "border-transparent bg-emerald-600 text-white hover:bg-emerald-600",
  REJECTED: "border-transparent bg-rose-600 text-white hover:bg-rose-600",
  WITHDRAWN: "",
};

export function ChangeStatusPill({ status }: { status: ChangeStatus }) {
  const { t } = useTranslation("directory");
  const className = STATUS_CLASS[status];
  if (status === "WITHDRAWN") {
    return <Badge variant="outline">{t(`changes.statusLabel.${status}`)}</Badge>;
  }
  return (
    <Badge variant="default" className={className}>
      {t(`changes.statusLabel.${status}`)}
    </Badge>
  );
}
