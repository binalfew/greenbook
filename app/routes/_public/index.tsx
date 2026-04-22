import { Search, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useFetcher, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { getUserId } from "~/utils/auth/auth.server";
import { prisma } from "~/utils/db/db.server";
import { publicListPeople } from "~/services/people.server";
import { PUBLIC_CACHE_HEADER, getPublicContext } from "~/utils/public-directory.server";
import { AUTOCOMPLETE_MIN_LENGTH, type Suggestion } from "~/utils/autocomplete";
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
  // Search-driven UX: no query → show the search prompt, don't list everyone.
  if (q.length === 0) {
    return data(
      { isEmpty: false as const, people: [], q, page: 1, totalPages: 1 },
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

      <SearchBox initialQuery={q} placeholder={t("landing.peopleSearchPlaceholder")} />

      {q.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("landing.searchPrompt")}
          body={t("landing.searchPromptHelp")}
        />
      ) : people.length === 0 ? (
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

// Debounced type-ahead over /api/search-people. Typing fires a fetch after
// 250ms of idle; Enter submits the GET form for the full results page; clicks
// on a suggestion navigate straight to the profile. Escape closes the
// dropdown without losing input focus.
function SearchBox({ initialQuery, placeholder }: { initialQuery: string; placeholder: string }) {
  const { t } = useTranslation("directory-public");
  const fetcher = useFetcher<{ results: Suggestion[] }>();
  const navigate = useNavigate();
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch — only fire when the trimmed value is long enough.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < AUTOCOMPLETE_MIN_LENGTH) return;
    const handle = window.setTimeout(() => {
      fetcher.load(`/api/search-people?q=${encodeURIComponent(trimmed)}`);
    }, 250);
    return () => window.clearTimeout(handle);
    // fetcher.load identity is stable — intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const suggestions = fetcher.data?.results ?? [];
  const showDropdown =
    open && value.trim().length >= AUTOCOMPLETE_MIN_LENGTH && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Form method="get" className="flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            name="q"
            value={value}
            onChange={(e) => {
              setValue(e.currentTarget.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                e.currentTarget.blur();
              }
            }}
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            placeholder={placeholder}
            className="pl-9"
          />
        </div>
        <Button type="submit">{t("landing.searchSubmit")}</Button>
      </Form>

      {showDropdown ? (
        <ul
          id={listboxId}
          role="listbox"
          className="bg-popover absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-md border shadow-lg"
        >
          {suggestions.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  navigate(`/people/${s.id}`);
                }}
                className="hover:bg-accent flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  {s.role ? (
                    <div className="text-muted-foreground truncate text-xs">{s.role}</div>
                  ) : null}
                </div>
                {s.memberState ? (
                  <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                    {s.memberState}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
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
