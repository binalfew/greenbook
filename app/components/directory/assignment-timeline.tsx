import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { formatDate } from "~/utils/format-date";

// Vertical timeline of PositionAssignment rows — reused by the Person
// detail (shows positions a person has held) and by the Position detail
// (shows who has held this post).
//
// Rows are pre-ordered by the service (current first, then by startDate
// desc). Render-time we just iterate and show badges for current entries.

export type TimelineMode = "byPerson" | "byPosition";

type PersonSide = {
  id: string;
  firstName: string;
  lastName: string;
  honorific: string | null;
};

type PositionSide = {
  id: string;
  title: string;
  organization: { id: string; name: string; acronym: string | null };
};

export type TimelineEntry = {
  id: string;
  startDate: Date | string;
  endDate: Date | string | null;
  isCurrent: boolean;
  notes?: string | null;
  /** When mode="byPerson", this is the position the person held. */
  position?: PositionSide;
  /** When mode="byPosition", this is the person who held the post. */
  person?: PersonSide;
};

export function AssignmentTimeline({
  entries,
  mode,
  basePrefix,
  endAction,
}: {
  entries: TimelineEntry[];
  mode: TimelineMode;
  /**
   * Base URL prefix for links — e.g. `/{tenant}/directory/positions` when
   * mode="byPerson" (rows link to the position), or the people prefix when
   * mode="byPosition" (rows link to the person).
   */
  basePrefix: string;
  /**
   * Optional slot rendered next to a `.isCurrent` entry. Used on the
   * Position detail to show a "End assignment" button that opens the
   * assignment-end dialog.
   */
  endAction?: (entry: TimelineEntry) => React.ReactNode;
}) {
  const { t } = useTranslation("directory");

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("assignments.empty")}</p>;
  }

  return (
    <ol className="relative border-l pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative mb-4 last:mb-0">
          <span className="bg-muted border-background absolute top-1.5 -left-[0.9rem] flex size-4 items-center justify-center rounded-full border-2">
            <CalendarClock className="text-muted-foreground size-2.5" />
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              {mode === "byPerson" && entry.position ? (
                <Link
                  to={`${basePrefix}/${entry.position.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {entry.position.title}
                </Link>
              ) : mode === "byPosition" && entry.person ? (
                <Link
                  to={`${basePrefix}/${entry.person.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {entry.person.honorific ? `${entry.person.honorific} ` : ""}
                  {entry.person.firstName} {entry.person.lastName}
                </Link>
              ) : null}
              {mode === "byPerson" && entry.position ? (
                <div className="text-muted-foreground text-xs">
                  {entry.position.organization.acronym || entry.position.organization.name}
                </div>
              ) : null}
              <div className="text-muted-foreground text-xs">
                {t("assignments.timelineFrom", { date: formatDate(entry.startDate) })}{" "}
                {t("assignments.timelineUntil", {
                  date: entry.endDate
                    ? formatDate(entry.endDate)
                    : t("assignments.timelinePresent"),
                })}
              </div>
              {entry.notes ? (
                <div className="text-muted-foreground mt-1 text-xs italic">{entry.notes}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {entry.isCurrent ? (
                <Badge variant="default">{t("assignments.timelineCurrent")}</Badge>
              ) : null}
              {endAction?.(entry)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
