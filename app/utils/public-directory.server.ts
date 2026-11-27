import { data } from "react-router";
import { publicGetPerson, publicListPeople } from "~/services/people.server";
import { getPublicTenantIds } from "~/services/public-directory.server";
import { AUTOCOMPLETE_MIN_LENGTH, SEARCH_PAGE_SIZE } from "~/utils/autocomplete";

// Helpers for the public (unauthenticated, cross-tenant) directory tier.
//
// Public loaders MUST NOT call `requireSession` / `resolveTenant` — they run
// for any visitor. They go straight through `getPublicTenantIds()` and pass
// the opted-in id set to each `public*` service helper.
//
// The `Cache-Control` header below is the default for public pages. Loaders
// can override when appropriate (e.g. lazy-load APIs get a shorter TTL).

export const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

/**
 * Resolve the set of tenant ids participating in the public directory.
 * Short-circuit when empty so callers can bail without further DB work.
 */
export async function getPublicContext() {
  const publicTenantIds = await getPublicTenantIds();
  return {
    publicTenantIds,
    isEmpty: publicTenantIds.length === 0,
  };
}

export function publicCacheHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", PUBLIC_CACHE_HEADER);
  return headers;
}

// Reshape a `publicListOrganization*` row (flat typeCode / typeLevel) into
// the include-shape the admin org wrappers expect (`type: { code, name, level }`
// + `_count: { children }`). Used by the public tree route and its
// lazy-load resource route so both entry points keep identical node shapes.
export function publicOrgToTreeNode(row: {
  id: string;
  name: string;
  acronym: string | null;
  typeCode: string;
  typeLevel: number;
  childCount: number;
}) {
  return {
    id: row.id,
    name: row.name,
    acronym: row.acronym,
    type: { code: row.typeCode, name: row.typeCode, level: row.typeLevel },
    _count: { children: row.childCount },
  };
}

/** Search and profile responses are per-session: never shared by a cache. */
export const DIRECTORY_CACHE_HEADER = "private, no-store";

/**
 * The people search behind `/` and `/<tenant>/directory`, read from the
 * request's `q` and `page`. The caller checks the login first. An empty or
 * too-short query runs no search.
 */
export async function loadDirectorySearch(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const none: PublicPersonListRow[] = [];

  const { publicTenantIds, isEmpty } = await getPublicContext();
  if (isEmpty) {
    return { isEmpty: true, tooShort: false, people: none, q, page, totalPages: 1 };
  }
  if (q.length < AUTOCOMPLETE_MIN_LENGTH) {
    return { isEmpty: false, tooShort: q.length > 0, people: none, q, page: 1, totalPages: 1 };
  }
  const result = await publicListPeople(publicTenantIds, {
    search: q,
    page,
    pageSize: SEARCH_PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / SEARCH_PAGE_SIZE));
  return { isEmpty: false, tooShort: false, people: result.data, q, page, totalPages };
}

export type DirectorySearchResults = Awaited<ReturnType<typeof loadDirectorySearch>>;
type PublicPersonListRow = Awaited<ReturnType<typeof publicListPeople>>["data"][number];

/** One profile from the directory; a 404 response when it is not published. */
export async function loadDirectoryProfile(personId: string) {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const person = isEmpty ? null : await publicGetPerson(personId, publicTenantIds);
  if (!person) {
    throw data(null, { status: 404, headers: { "Cache-Control": DIRECTORY_CACHE_HEADER } });
  }
  return person;
}

export type DirectoryProfile = Awaited<ReturnType<typeof loadDirectoryProfile>>;
