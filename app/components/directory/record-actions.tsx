import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";

// Edit + Delete buttons for a directory detail page. While the record is
// `locked` (it has a change waiting for review, so the engine would refuse a
// second one) the buttons are disabled and described by `RecordLockedNotice`,
// which the page renders under its action row.

const LOCKED_NOTICE_ID = "directory-record-locked";

export function RecordActions({
  editHref,
  deleteHref,
  locked,
}: {
  /** Omit when the user may not edit. */
  editHref?: string;
  /** Omit when the user may not delete. */
  deleteHref?: string;
  locked: boolean;
}) {
  const { t } = useTranslation("directory");
  const edit = (
    <>
      <Pencil className="mr-1 size-4" />
      {t("actions.edit")}
    </>
  );
  const del = (
    <>
      <Trash2 className="mr-1 size-4" />
      {t("actions.delete")}
    </>
  );

  if (locked) {
    return (
      <>
        {editHref ? (
          <Button size="sm" variant="outline" disabled aria-describedby={LOCKED_NOTICE_ID}>
            {edit}
          </Button>
        ) : null}
        {deleteHref ? (
          <Button size="sm" variant="destructive" disabled aria-describedby={LOCKED_NOTICE_ID}>
            {del}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      {editHref ? (
        <Button asChild size="sm" variant="outline">
          <Link to={editHref}>{edit}</Link>
        </Button>
      ) : null}
      {deleteHref ? (
        <Button asChild size="sm" variant="destructive">
          <Link to={deleteHref}>{del}</Link>
        </Button>
      ) : null}
    </>
  );
}

export function RecordLockedNotice() {
  const { t } = useTranslation("directory");
  return (
    <p id={LOCKED_NOTICE_ID} className="text-muted-foreground text-right text-xs">
      {t("conflicts.lockedByPendingChange")}
    </p>
  );
}
