import { Briefcase, Building2, Globe2, Languages, Mail, MapPin, Phone, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { Badge } from "~/components/ui/badge";
import { publicGetPerson } from "~/services/people.server";
import { formatDate } from "~/utils/format-date";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/$personId";

export async function loader({ params }: Route.LoaderArgs) {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const person = isEmpty ? null : await publicGetPerson(params.personId, publicTenantIds);
  if (!person) {
    throw data(null, { status: 404, headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
  }
  return data({ person }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

type Person = Route.ComponentProps["loaderData"]["person"];
type HistoryEntry = Person["history"][number];

export default function PublicPersonDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { person } = loaderData;
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ");
  const initials = `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase();

  // Defensive: the service invariant is "one current per person", but legacy
  // rows created before the rule landed may still have multiple isCurrent
  // entries. Pick the most recently started one as the true current and push
  // the rest into past so the public page shows a single current role.
  // Also hide zero-duration past rows (startDate === endDate) — these are
  // auto-closure artifacts, not real historical posts.
  const currentSorted = person.history
    .filter((e) => e.isCurrent)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  const current = currentSorted.slice(0, 1);
  const past = [...currentSorted.slice(1), ...person.history.filter((e) => !e.isCurrent)]
    .filter((e) => {
      if (!e.endDate) return true;
      return new Date(e.startDate).getTime() !== new Date(e.endDate).getTime();
    })
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12 sm:px-6 lg:px-8">
      {/* Single full-width profile card. Thin primary strip + overlapping
          avatar keeps the brand color on the page; every section of the
          profile lives inside. */}
      <article className="bg-card overflow-hidden rounded-xl border shadow-sm">
        <div className="bg-primary h-20" />

        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
            <div className="bg-card border-background -mt-12 grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 shadow-sm">
              <div className="bg-primary/10 text-primary grid size-full place-items-center">
                {person.photoUrl ? (
                  <img
                    src={person.photoUrl}
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
                <>
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
                  {current[0].position.reportsTo ? (
                    <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                      <span className="font-medium">{t("positionDetail.reportsTo")}:</span>{" "}
                      <span className="text-foreground">{current[0].position.reportsTo.title}</span>
                      {current[0].position.reportsTo.currentHolder ? (
                        <>
                          {" "}
                          ·{" "}
                          <span>
                            {[
                              current[0].position.reportsTo.currentHolder.honorific,
                              current[0].position.reportsTo.currentHolder.firstName,
                              current[0].position.reportsTo.currentHolder.lastName,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          </span>
                        </>
                      ) : (
                        <>
                          {" "}
                          · <span className="italic">{t("positionDetail.vacant")}</span>
                        </>
                      )}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          {/* Meta strip — nationality / languages / contact in one row */}
          {(person.memberState || person.languages.length > 0 || person.email || person.phone) && (
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
                          {lang}
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
                  {!person.email && !person.phone ? (
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
                        currentLabel={t("landing.currentRole")}
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
        </div>
      </article>
    </div>
  );
}

/* ── Subcomponents ─────────────────────────────── */

function CurrentRoleCard({ entry, currentLabel }: { entry: HistoryEntry; currentLabel: string }) {
  return (
    <li className="border-primary/30 bg-primary/[0.04] relative flex items-start gap-4 rounded-xl border p-4">
      <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-lg">
        <Briefcase className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-foreground font-semibold">{entry.position.title}</div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <Building2 className="size-3" />
              {entry.position.organization.acronym || entry.position.organization.name}
            </div>
          </div>
          <Badge variant="default" className="shrink-0">
            {currentLabel}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-2 text-xs">
          {formatDate(entry.startDate)}
          {" — "}
          {currentLabel}
        </div>
      </div>
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

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="person" />;
}
