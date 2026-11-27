import { execSync } from "node:child_process";

// Playwright global setup — runs once before all E2E tests.
// Syncs the schema to the test DB and seeds baseline data.
const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@localhost:${process.env.DB_TEST_PORT || "5433"}/${process.env.DB_TEST_NAME || "app_test"}`;

export default async function globalSetup() {
  console.log("\n[E2E] Preparing test database...");

  execSync(`DATABASE_URL="${TEST_DB_URL}" npx prisma db push --accept-data-loss`, {
    stdio: "inherit",
  });

  // The seed needs the global admin's login; the test database gets a fixed one
  // unless the environment already names another.
  execSync(`DATABASE_URL="${TEST_DB_URL}" npx tsx prisma/seed.ts`, {
    stdio: "inherit",
    env: {
      SEED_ADMIN_EMAIL: "admin@greenbook.test",
      SEED_ADMIN_PASSWORD: "e2e-test-admin-password",
      ...process.env,
    },
  });

  console.log("[E2E] Test database ready.\n");
}
