import { data } from "react-router";
import { getUserId } from "~/utils/auth/auth.server";
import { publicListPeople } from "~/services/people.server";
import { AUTOCOMPLETE_MIN_LENGTH, SEARCH_PAGE_SIZE, type Suggestion } from "~/utils/autocomplete";
import { getPublicContext } from "~/utils/public-directory.server";
import type { Route } from "./+types/api.search-people";

// JSON endpoint for type-ahead search on the landing page. Mirrors
// `publicListPeople` but capped at SUGGESTION_LIMIT so the dropdown stays
// fast. The directory is for AU staff + member states only, so this
// endpoint requires an authenticated session (post-demo feedback).
const SUGGESTION_LIMIT = SEARCH_PAGE_SIZE;
// Auth-gated, so responses are private (never shared edge cache) but a short
// per-user TTL still smooths repeated keystrokes.
const AUTOCOMPLETE_CACHE_HEADER = "private, max-age=15";

export async function loader({ request }: Route.LoaderArgs) {
  // Login required for any search — the directory serves AU staff and
  // member states, not the anonymous public. A bare 401 (rather than a login
  // redirect) lets the search box's `fetch` see a non-ok status and show no
  // suggestions instead of parsing a login page.
  const userId = await getUserId(request);
  if (!userId) {
    throw new Response("Unauthorized", { status: 401 });
  }

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
          }${p.currentAssignments.length > 1 ? ` (+${p.currentAssignments.length - 1})` : ""}`
        : null,
      memberState: p.memberState?.abbreviation ?? null,
    };
  });

  return data({ results }, { headers: { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": AUTOCOMPLETE_CACHE_HEADER };
}
