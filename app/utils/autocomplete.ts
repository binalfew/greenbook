// Shared constants + types for the public people-search autocomplete.
// Lives outside any `.server.ts` file so the browser can import it without
// dragging server-only modules into the client bundle.

export const AUTOCOMPLETE_MIN_LENGTH = 2;

export type Suggestion = {
  id: string;
  name: string;
  role: string | null;
  memberState: string | null;
};
