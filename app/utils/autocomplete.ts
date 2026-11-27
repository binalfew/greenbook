// Shared constants + types for the public people-search autocomplete.
// Lives outside any `.server.ts` file so the browser can import it without
// dragging server-only modules into the client bundle.

// Searches must start with at least three characters — keeps result sets
// meaningful and curbs table-scan-style fishing (post-demo feedback).
export const AUTOCOMPLETE_MIN_LENGTH = 3;

// Public search results paginate at five per page (post-demo feedback):
// small enough to scan at a glance, pagination kicks in beyond it.
export const SEARCH_PAGE_SIZE = 5;

export type Suggestion = {
  id: string;
  name: string;
  role: string | null;
  memberState: string | null;
};
