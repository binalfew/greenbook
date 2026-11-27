import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";

// One-off upgrade step, run before `prisma db push` by `npm run db:push`.
//
// `UserRole` is unique on (userId, roleId). Databases created before that
// index could store the same role twice for one user, and the push cannot
// add the index while such rows exist. This removes the extra copies, keeping
// one row of each. It is safe to run any number of times and on a database
// that has no tables yet.

type Query = (sql: string) => Promise<Record<string, unknown>[]>;

/** Delete duplicate (userId, roleId) rows; returns how many were removed. */
export async function dedupeUserRoles(query: Query): Promise<number> {
  const [found] = await query(`SELECT to_regclass('public."UserRole"')::text AS "table"`);
  if (!found?.table) return 0;

  const removed = await query(`
    DELETE FROM "UserRole" extra
    USING "UserRole" kept
    WHERE extra."userId" = kept."userId"
      AND extra."roleId" = kept."roleId"
      AND extra.id > kept.id
    RETURNING extra.id
  `);
  return removed.length;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
  await client.connect();
  try {
    const removed = await dedupeUserRoles(async (sql) => (await client.query(sql)).rows);
    if (removed > 0) console.log(`Removed ${removed} duplicate user role row(s).`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
