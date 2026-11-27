import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PossibleDuplicate } from "~/services/person-duplicates.server";

/** Form field the person editor posts to save past the warning. */
export const CONFIRM_DUPLICATES_FIELD = "confirmDuplicates";

// Warning listing people that may be the same person as the one being saved
// (person editor) or reviewed (change detail page). Advisory only. Published
// people link to their record; drafts and pending requests are named but not
// linked, since the viewer may not be allowed to open them.

export function PossibleDuplicates({
  duplicates,
  peopleHref,
  forSave = false,
}: {
  duplicates: PossibleDuplicate[];
  /** Tenant people list URL, e.g. `/acme/people`. */
  peopleHref: string;
  /** Shown in an editor after a save was held back, rather than on a review page. */
  forSave?: boolean;
}) {
  const { t } = useTranslation("directory");
  if (duplicates.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">{t("duplicates.title")}</p>
      <p>{forSave ? t("duplicates.saveHelp") : t("duplicates.reviewHelp")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {duplicates.map((duplicate) => {
          const name = `${duplicate.firstName} ${duplicate.lastName}`.trim();
          return (
            <li key={`${duplicate.source}-${duplicate.id}`}>
              {duplicate.source === "PERSON" ? (
                <Link
                  to={`${peopleHref}/${duplicate.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {name}
                </Link>
              ) : (
                <span className="font-medium">{name}</span>
              )}
              {duplicate.email ? ` (${duplicate.email})` : null}
              {" — "}
              {t(`duplicates.source.${duplicate.source}`)}
              {", "}
              {duplicate.matchedOn.map((on) => t(`duplicates.matchedOn.${on}`)).join(", ")}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
