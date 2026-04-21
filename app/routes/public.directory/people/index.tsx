import { Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { publicListPeople } from "~/services/people.server";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

const PAGE_SIZE = 20;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { publicTenantIds, isEmpty } = await getPublicContext();
  const result = isEmpty
    ? { data: [], total: 0 }
    : await publicListPeople(publicTenantIds, { search, page, pageSize: PAGE_SIZE });

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return data(
    {
      people: result.data,
      total: result.total,
      page,
      totalPages,
      search,
    },
    { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } },
  );
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicPeopleIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { people, page, totalPages, search } = loaderData;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("peoplePage.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("peoplePage.subtitle")}</p>
      </header>

      <Form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={search}
            placeholder={t("peoplePage.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button type="submit">{t("search")}</Button>
      </Form>

      {people.length === 0 ? (
        <div className="bg-muted/20 flex flex-col items-center justify-center rounded-lg border py-12 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <Users className="text-muted-foreground size-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">{t("peoplePage.empty")}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">{t("peoplePage.emptyHelp")}</p>
        </div>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {people.map((person) => {
            const current = person.currentAssignments[0];
            return (
              <li key={person.id}>
                <Link
                  to={`/public/directory/people/${person.id}`}
                  className="hover:bg-muted/60 flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {person.honorific ? `${person.honorific} ` : ""}
                      {person.firstName} {person.lastName}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {current ? (
                        <>
                          {t("peoplePage.currentPosition")}:{" "}
                          <span className="text-foreground">{current.positionTitle}</span>
                          {current.organization && (
                            <>
                              {" · "}
                              <span>
                                {current.organization.acronym ?? current.organization.name}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        t("peoplePage.noCurrent")
                      )}
                    </div>
                  </div>
                  {person.memberState && (
                    <div className="text-muted-foreground shrink-0 text-xs">
                      {person.memberState.abbreviation ?? person.memberState.fullName}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} search={search} t={t} />}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  search,
  t,
}: {
  page: number;
  totalPages: number;
  search: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const buildHref = (next: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const qs = params.toString();
    return qs ? `/public/directory/people?${qs}` : "/public/directory/people";
  };

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {t("peoplePage.page", { page, total: totalPages })}
      </span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          <Link to={buildHref(Math.max(1, page - 1))} rel="prev">
            ←
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
          <Link to={buildHref(Math.min(totalPages, page + 1))} rel="next">
            →
          </Link>
        </Button>
      </div>
    </div>
  );
}
