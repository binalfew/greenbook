import { requireAuth } from "~/utils/auth/require-auth.server";
import { globalSearch, type SearchResults } from "~/services/search.server";
import type { Route } from "./+types/search";

/**
 * Resource route powering the ⌘K command palette's entity search. The palette
 * fetches `${basePrefix}/search?q=...` with a debounced user query; this
 * loader validates auth + tenant membership and hands the query off to
 * `globalSearch`. Returns relative result URLs that the palette prepends with
 * the tenant basePrefix at navigation time.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const tenantId = user.tenantId;
  if (!tenantId) {
    return { query: "", results: null as SearchResults | null };
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  if (!query || query.length < 2) {
    return { query, results: null as SearchResults | null };
  }

  const results = await globalSearch(query, tenantId);
  return { query, results };
}
