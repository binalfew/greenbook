import { prisma } from "~/utils/db/db.server";

// Possible-duplicate check for people. Read-only and advisory: callers show
// the matches as a warning and never block on them. Everything is scoped to
// one tenant, so a warning cannot reveal a person from another tenant.

export type PossibleDuplicate = {
  /** A published person, or an open change request that carries a person. */
  source: "PERSON" | "DRAFT" | "PENDING";
  /** Person id for `PERSON`, change-request id otherwise. */
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  matchedOn: Array<"name" | "email">;
};

export type DuplicateCandidate = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type DuplicateExclusions = {
  /** The person being edited: never reported against itself. */
  personId?: string | null;
  /** The change request being re-saved or reviewed. */
  changeId?: string | null;
};

/** Case-, accent- and whitespace-insensitive comparison key. */
function normalise(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function nameKey(person: DuplicateCandidate): string {
  return normalise(`${person.firstName ?? ""} ${person.lastName ?? ""}`);
}

export async function findPossibleDuplicatePeople(
  tenantId: string,
  candidate: DuplicateCandidate,
  exclude: DuplicateExclusions = {},
): Promise<PossibleDuplicate[]> {
  const name = nameKey(candidate);
  const email = normalise(candidate.email);
  if (!name && !email) return [];

  const matchedOn = (other: DuplicateCandidate): PossibleDuplicate["matchedOn"] => {
    const on: PossibleDuplicate["matchedOn"] = [];
    if (name && nameKey(other) === name) on.push("name");
    if (email && normalise(other.email) === email) on.push("email");
    return on;
  };

  const [people, changes] = await Promise.all([
    prisma.person.findMany({
      where: { tenantId, deletedAt: null, id: { not: exclude.personId ?? undefined } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    prisma.changeRequest.findMany({
      where: {
        tenantId,
        entityType: "PERSON",
        operation: { in: ["CREATE", "UPDATE"] },
        status: { in: ["DRAFT", "PENDING"] },
        id: { not: exclude.changeId ?? undefined },
      },
      orderBy: { submittedAt: "asc" },
      select: { id: true, status: true, entityId: true, payload: true },
    }),
  ]);

  const matches: PossibleDuplicate[] = [];
  const matchedPersonIds = new Set<string>();
  for (const person of people) {
    const on = matchedOn(person);
    if (on.length === 0) continue;
    matchedPersonIds.add(person.id);
    matches.push({ source: "PERSON", ...person, matchedOn: on });
  }

  for (const change of changes) {
    // An open edit of the excluded person, or of a person already listed.
    if (change.entityId && change.entityId === exclude.personId) continue;
    if (change.entityId && matchedPersonIds.has(change.entityId)) continue;
    const payload = (change.payload ?? {}) as Record<string, unknown>;
    const other = {
      firstName: typeof payload.firstName === "string" ? payload.firstName : "",
      lastName: typeof payload.lastName === "string" ? payload.lastName : "",
      email: typeof payload.email === "string" && payload.email ? payload.email : null,
    };
    const on = matchedOn(other);
    if (on.length === 0) continue;
    matches.push({
      source: change.status === "DRAFT" ? "DRAFT" : "PENDING",
      id: change.id,
      ...other,
      matchedOn: on,
    });
  }

  return matches;
}
