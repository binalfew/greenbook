import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "../../app/generated/prisma/client.js";

// Suppress Prisma engine logs for expected constraint violations so the test
// output stays readable. Uncomment lines and comment the filter to debug.
const _origLog = console.log;
const _origErr = console.error;
const _origWarn = console.warn;
const shouldFilter = (args: unknown[]) =>
  args.some((a) => String(a).includes("prisma:error") || String(a).includes("Unique constraint"));
console.log = (...args: unknown[]) => {
  if (shouldFilter(args)) return;
  _origLog(...args);
};
console.error = (...args: unknown[]) => {
  if (shouldFilter(args)) return;
  _origErr(...args);
};
console.warn = (...args: unknown[]) => {
  if (shouldFilter(args)) return;
  _origWarn(...args);
};

const testDbUrl =
  process.env.DATABASE_TEST_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@localhost:${process.env.DB_TEST_PORT || "5433"}/${process.env.DB_TEST_NAME || "app_test"}`;
const adapter = new PrismaPg({ connectionString: testDbUrl });

// Exported so tests can `import { prisma } from "~/../tests/setup/integration-setup"`
// when they need direct DB access for arrange/assert.
export const prisma = new PrismaClient({ adapter });

// Truncate everything between tests. CASCADE handles FK dependencies without
// forcing an order. Trust the test DB to be short-lived (Docker tmpfs) so
// brute-force wipe is cheap.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
