import { ArrowLeft, Briefcase, Mail, Phone, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
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

export default function PublicPersonDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { person } = loaderData;
  const displayName = [person.honorific, person.firstName, person.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("personDetail.backToPeople")}
      </Link>

      <header className="flex items-start gap-4">
        <div className="bg-primary/10 text-primary grid size-16 shrink-0 place-items-center overflow-hidden rounded-md">
          {person.photoUrl ? (
            <img
              src={person.photoUrl}
              alt={displayName}
              className="size-full object-cover"
              loading="lazy"
              width={64}
              height={64}
            />
          ) : (
            <User className="size-8" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          {person.memberState && (
            <div className="text-muted-foreground text-sm">
              <span className="text-xs tracking-wide uppercase">
                {t("personDetail.nationality")}:{" "}
              </span>
              {person.memberState.fullName}
            </div>
          )}
          {person.languages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground text-xs tracking-wide uppercase">
                {t("personDetail.languages")}:
              </span>
              {person.languages.map((lang) => (
                <Badge key={lang} variant="outline">
                  {lang}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {person.bio && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t("personDetail.biography")}</h2>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{person.bio}</p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">{t("personDetail.currentPositions")}</h2>
            {person.history.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("landing.noCurrentRole")}</p>
            ) : (
              <ol className="relative space-y-4 border-l pl-4">
                {person.history.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span className="bg-muted border-background absolute top-1.5 -left-[0.9rem] flex size-4 items-center justify-center rounded-full border-2">
                      <Briefcase className="text-muted-foreground size-2.5" />
                    </span>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-medium">{entry.position.title}</div>
                        <div className="text-muted-foreground text-xs">
                          {entry.position.organization.acronym || entry.position.organization.name}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatDate(entry.startDate)}
                          {" — "}
                          {entry.endDate ? formatDate(entry.endDate) : t("landing.currentRole")}
                        </div>
                      </div>
                      {entry.isCurrent ? (
                        <Badge variant="default">{t("landing.currentRole")}</Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="bg-muted/30 space-y-3 rounded-md border p-4 text-sm">
            <div className="text-muted-foreground text-xs tracking-wide uppercase">
              {t("personDetail.contact")}
            </div>
            {person.email || person.phone ? (
              <>
                {person.email && (
                  <a
                    href={`mailto:${person.email}`}
                    className="text-primary flex items-center gap-2 hover:underline"
                  >
                    <Mail className="size-4" />
                    {person.email}
                  </a>
                )}
                {person.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="size-4" />
                    {person.phone}
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground text-xs">
                {t("personDetail.contactPrivate")}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="person" />;
}
