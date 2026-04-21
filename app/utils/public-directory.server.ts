import { getPublicTenantIds } from "~/services/public-directory.server";

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
