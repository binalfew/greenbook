import { ArrowLeft, Mail, Phone, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { Badge } from "~/components/ui/badge";
import { publicGetPerson } from "~/services/people.server";
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
    <div className="space-y-6">
      <Link
        to="/public/directory/people"
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
            {person.currentAssignments.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("peoplePage.noCurrent")}</p>
            ) : (
              <ul className="divide-border divide-y rounded-md border">
                {person.currentAssignments.map((a) => (
                  <li key={a.positionId}>
                    <Link
                      to={`/public/directory/positions/${a.positionId}`}
                      className="hover:bg-muted/60 flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="text-sm font-medium">{a.positionTitle}</div>
                        {a.organization && (
                          <div className="text-muted-foreground text-xs">
                            {a.organization.acronym ?? a.organization.name}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
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
