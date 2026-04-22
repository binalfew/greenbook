import { data } from "react-router";
import { publicListPeople } from "~/services/people.server";
import { AUTOCOMPLETE_MIN_LENGTH, type Suggestion } from "~/utils/autocomplete";
import { getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/api.search-people";

// Public JSON endpoint for type-ahead search on the landing page. Mirrors
// `publicListPeople` but capped at SUGGESTION_LIMIT so the dropdown stays
// fast. Shorter cache TTL than detail pages — search suggestions should
// update sooner after an edit lands.
const SUGGESTION_LIMIT = 8;
const AUTOCOMPLETE_CACHE_HEADER = "public, max-age=30, stale-while-revalidate=120";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < AUTOCOMPLETE_MIN_LENGTH) {
    return data(
      { results: [] as Suggestion[] },
      { headers: { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER } },
    );
  }

  const { publicTenantIds, isEmpty } = await getPublicContext();
  if (isEmpty) {
    return data(
      { results: [] as Suggestion[] },
      { headers: { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER } },
    );
  }

  const { data: people } = await publicListPeople(publicTenantIds, {
    search: q,
    page: 1,
    pageSize: SUGGESTION_LIMIT,
  });

  const results: Suggestion[] = people.map((p) => {
    const current = p.currentAssignments[0];
    return {
      id: p.id,
      name: [p.honorific, p.firstName, p.lastName].filter(Boolean).join(" "),
      role: current
        ? `${current.positionTitle}${
            current.organization
              ? ` · ${current.organization.acronym ?? current.organization.name}`
              : ""
          }`
        : null,
      memberState: p.memberState?.abbreviation ?? null,
    };
  });

  return data({ results }, { headers: { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER };
}
