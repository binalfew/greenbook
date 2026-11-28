import { Briefcase, Building2, Globe2, Languages, Mail, MapPin, Phone, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { formatDate } from "~/utils/format-date";
import { useDirectoryBase } from "~/hooks/use-directory-base";
import type { DirectoryProfile } from "~/utils/public-directory.server";

// A person's directory profile. Rendered at `/people/<id>` for readers and at
// `/<tenant>/directory/people/<id>` inside a workspace.

type Person = DirectoryProfile;
type HistoryEntry = Person["history"][number];
type ReportsChainEntry = Person["reportsChain"][number];

export function PersonProfile({ person }: { person: DirectoryProfile }) {
  const { t } = useTranslation("directory-public");
  const { t: tc } = useTranslation("common");
  // Flush in a workspace's content area; a centred column at the site root.
  const base = useDirectoryBase();
  const inWorkspace = base !== "";
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ");
  const initials = `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase();

  // A person can hold several positions at once: every current one is shown,
  // most recently started first, which is also the one named in the header
  // and at the end of the reporting line.
  const byStartDesc = (a: { startDate: Date | string }, b: { startDate: Date | string }) =>
    new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  const current = person.history.filter((e) => e.isCurrent).sort(byStartDesc);
  const past = person.history.filter((e) => !e.isCurrent).sort(byStartDesc);

  return (
    <div className={inWorkspace ? "" : "mx-auto w-full max-w-6xl px-4 pt-6 pb-12 sm:px-6 lg:px-8"}>
      {/* Single full-width profile card. Thin primary strip + overlapping
          avatar keeps the brand color on the page; every section of the
          profile lives inside. */}
      <article className="bg-card overflow-hidden rounded-xl border shadow-sm">
        <div className="bg-primary h-20" />

        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
            <div className="bg-card border-background -mt-12 grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 shadow-sm">
              <div className="bg-primary/10 text-primary grid size-full place-items-center">
                {person.photoId ? (
                  <img
                    src={`/people/${person.id}/photo?v=${person.photoId}`}
                    alt={fullName}
                    className="size-full object-cover"
                    loading="eager"
                    width={96}
                    height={96}
                  />
                ) : (
                  <span className="text-2xl font-semibold">
                    {initials || <User className="size-9" />}
                  </span>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {person.honorific ? (
                  <span className="text-muted-foreground font-medium">{person.honorific} </span>
                ) : null}
                {fullName}
              </h1>
              {current.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                  {current[0].position.title}
                  {current[0].position.organization ? (
                    <>
                      {" "}
                      ·{" "}
                      <span className="text-foreground">
                        {current[0].position.organization.acronym ||
                          current[0].position.organization.name}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>

          {/* Meta strip — nationality / languages / contact in one row */}
          {(person.memberState ||
            person.languages.length > 0 ||
            person.email ||
            person.phone ||
            person.officeEmail ||
            person.officePhone) && (
            <div className="border-border mt-6 grid gap-6 border-t pt-6 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <Globe2 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t("personDetail.nationality")}
                  </div>
                  <div className="text-foreground mt-1 text-sm">
                    {person.memberState?.fullName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Languages className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t("personDetail.languages")}
                  </div>
                  {person.languages.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {person.languages.map((lang) => (
                        <Badge key={lang} variant="secondary">
                          {tc(`languageNames.${lang}`, lang)}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground mt-1 text-sm">—</div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t("personDetail.contact")}
                  </div>
                  {person.email ? (
                    <a
                      href={`mailto:${person.email}`}
                      className="text-foreground hover:text-primary block truncate text-sm transition-colors"
                    >
                      {person.email}
                    </a>
                  ) : null}
                  {person.phone ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Phone className="text-muted-foreground size-3" />
                      {person.phone}
                    </div>
                  ) : null}
                  {person.officeEmail || person.officePhone ? (
                    <div className="border-border/60 mt-1 space-y-1 border-t pt-1">
                      <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                        {t("personDetail.officialContact")}
                      </div>
                      {person.officeEmail ? (
                        <a
                          href={`mailto:${person.officeEmail}`}
                          className="text-foreground hover:text-primary block truncate text-sm transition-colors"
                        >
                          {person.officeEmail}
                        </a>
                      ) : null}
                      {person.officePhone ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <Phone className="text-muted-foreground size-3" />
                          {person.officePhone}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {!person.email && !person.phone && !person.officeEmail && !person.officePhone ? (
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <MapPin className="size-3 shrink-0" />
                      {t("personDetail.contactPrivate")}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Biography */}
          {person.bio && (
            <div className="border-border mt-8 border-t pt-6">
              <h2 className="text-muted-foreground mb-3 text-[11px] font-semibold tracking-wider uppercase">
                {t("personDetail.biography")}
              </h2>
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {person.bio}
              </p>
            </div>
          )}

          {/* Career */}
          <div className="border-border mt-8 border-t pt-6">
            <h2 className="text-muted-foreground mb-4 text-[11px] font-semibold tracking-wider uppercase">
              {current.length > 0
                ? t("personDetail.currentPositions")
                : past.length > 0
                  ? t("personDetail.pastPositions")
                  : t("landing.noCurrentRole")}
            </h2>

            {current.length === 0 && past.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("landing.noCurrentRole")}</p>
            ) : (
              <div className="space-y-6">
                {current.length > 0 && (
                  <ul className="space-y-3">
                    {current.map((entry) => (
                      <CurrentRoleCard
                        key={entry.id}
                        entry={entry}
                        sinceLabel={t("personDetail.since", { date: formatDate(entry.startDate) })}
                      />
                    ))}
                  </ul>
                )}

                {past.length > 0 && (
                  <div>
                    {current.length > 0 && (
                      <h3 className="text-muted-foreground mb-3 text-[11px] font-semibold tracking-wider uppercase">
                        {t("personDetail.pastPositions")}
                      </h3>
                    )}
                    <ol className="border-primary/20 relative space-y-5 border-l-2 pl-6">
                      {past.map((entry) => (
                        <PastRoleEntry key={entry.id} entry={entry} />
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reporting line — who this person reports to, from the top of the
              chain down to them. Omitted when there's no current post or no
              upward hop. */}
          {person.reportsChain.length > 0 ? (
            <div className="border-border mt-8 border-t pt-6">
              <h2 className="text-muted-foreground mb-4 text-[11px] font-semibold tracking-wider uppercase">
                {t("personDetail.reportingLine")}
              </h2>
              <ol>
                {person.reportsChain.map((entry) => (
                  <ReportingLineStep
                    key={entry.positionId}
                    name={
                      entry.holder
                        ? [entry.holder.honorific, entry.holder.firstName, entry.holder.lastName]
                            .filter(Boolean)
                            .join(" ")
                        : null
                    }
                    initials={
                      entry.holder
                        ? `${entry.holder.firstName[0] ?? ""}${entry.holder.lastName[0] ?? ""}`
                        : ""
                    }
                    positionTitle={entry.positionTitle}
                    organization={entry.organization.acronym || entry.organization.name}
                    href={entry.holder ? `${base}/people/${entry.holder.id}` : null}
                    vacantLabel={t("personDetail.reportingLineVacant")}
                  />
                ))}
                {/* The line ends at the person this profile is about. */}
                <ReportingLineStep
                  name={[person.honorific, fullName].filter(Boolean).join(" ")}
                  initials={initials}
                  positionTitle={current[0]?.position.title ?? ""}
                  organization={
                    current[0]
                      ? current[0].position.organization.acronym ||
                        current[0].position.organization.name
                      : ""
                  }
                  href={null}
                  vacantLabel=""
                  self
                />
              </ol>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

/* ── Subcomponents ─────────────────────────────── */

function CurrentRoleCard({ entry, sinceLabel }: { entry: HistoryEntry; sinceLabel: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-full">
        <Briefcase className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-foreground text-sm font-semibold">{entry.position.title}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {entry.position.organization.name}
          {entry.position.organization.acronym ? ` (${entry.position.organization.acronym})` : ""}
          {" · "}
          {sinceLabel}
        </div>
      </div>
    </li>
  );
}

// One person in the reporting line: an avatar on a vertical rail, the holder's
// name first (it is who you report to), their position and unit beneath. A
// vacant post shows a dashed avatar; the last step is the profile's own person.
function ReportingLineStep({
  name,
  initials,
  positionTitle,
  organization,
  href,
  vacantLabel,
  self = false,
}: {
  name: string | null;
  initials: string;
  positionTitle: string;
  organization: string;
  href: string | null;
  vacantLabel: string;
  self?: boolean;
}) {
  const row = (
    <div
      className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
        href ? "hover:bg-muted/60 transition-colors" : ""
      }`}
    >
      <span
        className={`bg-card relative z-10 grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${
          self
            ? "bg-primary text-primary-foreground"
            : name
              ? "text-primary ring-primary/30 ring-1"
              : "text-muted-foreground border border-dashed"
        }`}
        aria-hidden="true"
      >
        {name ? initials.toUpperCase() || <User className="size-4" /> : null}
      </span>
      <div className="min-w-0">
        <div className={`truncate text-sm ${self ? "font-semibold" : "font-medium"}`}>
          {name ?? <span className="text-muted-foreground italic">{vacantLabel}</span>}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {[positionTitle, organization].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );

  return (
    <li className="before:bg-border relative pb-2 before:absolute before:top-9 before:bottom-0 before:left-[1.625rem] before:w-px last:pb-0 last:before:hidden">
      {href ? (
        <Link to={href} className="block">
          {row}
        </Link>
      ) : (
        <div aria-current={self ? "true" : undefined}>{row}</div>
      )}
    </li>
  );
}

function PastRoleEntry({ entry }: { entry: HistoryEntry }) {
  return (
    <li className="relative">
      <span className="bg-background border-primary/40 absolute top-1.5 -left-[0.55rem] flex size-3 items-center justify-center rounded-full border-2" />
      <div className="text-foreground font-medium">{entry.position.title}</div>
      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
        <Building2 className="size-3" />
        {entry.position.organization.acronym || entry.position.organization.name}
      </div>
      <div className="text-muted-foreground mt-1 text-xs">
        {formatDate(entry.startDate)}
        {entry.endDate ? ` — ${formatDate(entry.endDate)}` : ""}
      </div>
    </li>
  );
}
