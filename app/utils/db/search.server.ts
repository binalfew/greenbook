// Normalise a user-supplied search string before it reaches a Prisma
// `contains` query. Short searches (1 char) are useless and hit full table
// scans; long searches are almost always abuse. Return `undefined` to skip
// the filter entirely.
//
// Values outside the min/max window are discarded — not rejected — so a
// user typing "a" in a search box doesn't get an error; the filter just
// becomes inactive until they type more.
export function normaliseSearchTerm(
  input: unknown,
  { min = 2, max = 100 }: { min?: number; max?: number } = {},
): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed.length < min) return undefined;
  return trimmed.slice(0, max);
}
