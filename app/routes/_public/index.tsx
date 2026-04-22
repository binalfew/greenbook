import { Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { getUserId } from "~/utils/auth/auth.server";
import { prisma } from "~/utils/db/db.server";
import { publicListPeople } from "~/services/people.server";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

// Public landing at `/` — the only public surface. Search across people
// profiles (name/bio) with pagination at 20 per page. Authenticated tenant
// users are bounced to their tenant admin dashboard so typing the bare
// domain still lands operators in their workspace.

const PAGE_SIZE = 20;

export async function loader({ request }: Route.LoaderArgs) {
  // Operator shortcut — authenticated tenant users skip the public page
  // and go straight to their admin dashboard.
  const userId = await getUserId(request);
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenant: { select: { slug: true } } },
    });
    if (user?.tenant?.slug) throw redirect(`/${user.tenant.slug}`);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { publicTenantIds, isEmpty } = await getPublicContext();
  if (isEmpty) {
    return data(
      { isEmpty: true as const, people: [], q, page, totalPages: 1 },
      { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } },
    );
  }
  const result = await publicListPeople(publicTenantIds, { search: q, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  return data(
    { isEmpty: false as const, people: result.data, q, page, totalPages },
    { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } },
  );
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

type PublicPerson = Route.ComponentProps["loaderData"]["people"][number];

export default function PublicPeopleIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { isEmpty, people, q, page, totalPages } = loaderData;

  if (isEmpty) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold">{t("landing.emptyOverall")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t("landing.emptyOverallHelp")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("people")}</h1>
        <p className="text-muted-foreground text-sm">{t("landing.heroDescription")}</p>
      </header>

      <Form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={t("landing.peopleSearchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button type="submit">{t("landing.searchSubmit")}</Button>
      </Form>

      {people.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("landing.peopleEmpty")}
          body={t("landing.peopleEmptyHelp")}
        />
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              currentRoleLabel={t("landing.currentRole")}
              noCurrentRole={t("landing.noCurrentRole")}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <Pagination
          q={q}
          page={page}
          totalPages={totalPages}
          pageLabel={t("landing.page", { page, total: totalPages })}
        />
      )}
    </div>
  );
}

function PersonRow({
  person,
  currentRoleLabel,
  noCurrentRole,
}: {
  person: PublicPerson;
  currentRoleLabel: string;
  noCurrentRole: string;
}) {
  const current = person.currentAssignments[0];
  return (
    <li>
      <Link
        to={`/people/${person.id}`}
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
                {currentRoleLabel}: <span className="text-foreground">{current.positionTitle}</span>
                {current.organization && (
                  <>
                    {" · "}
                    <span>{current.organization.acronym ?? current.organization.name}</span>
                  </>
                )}
              </>
            ) : (
              noCurrentRole
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
}

function Pagination({
  q,
  page,
  totalPages,
  pageLabel,
}: {
  q: string;
  page: number;
  totalPages: number;
  pageLabel: string;
}) {
  const buildHref = (next: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (next > 1) params.set("page", String(next));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{pageLabel}</span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          <Link to={buildHref(Math.max(1, page - 1))} rel="prev" aria-label="Previous page">
            ←
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
          <Link to={buildHref(Math.min(totalPages, page + 1))} rel="next" aria-label="Next page">
            →
          </Link>
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Users;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-muted/20 flex flex-col items-center justify-center rounded-lg border py-12 text-center">
      <div className="bg-muted flex size-12 items-center justify-center rounded-full">
        <Icon className="text-muted-foreground size-6" />
      </div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{body}</p>
    </div>
  );
}
