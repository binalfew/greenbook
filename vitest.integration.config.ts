import { config as loadDotenv } from "dotenv";
import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Integration-test runner — points at a separate Postgres on 5433 by default (see
// docker-compose), or wherever DB_TEST_PORT / DATABASE_TEST_URL say.
// Each test starts with a fresh truncation; tests share the DB by running serially.
//
// The DB_* keys are also read from `.env` so a DB_TEST_PORT set for docker-compose
// moves the tests too. Without that the container and the tests can disagree on
// the port, and the setup file would truncate whatever else is listening on 5433.
// Only those keys are read — the rest of `.env` is deliberately not leaked into
// the test process.
const fileEnv = loadDotenv({ processEnv: {}, quiet: true }).parsed ?? {};
const env = (key: string) => process.env[key] || fileEnv[key];
const testDbUrl =
  env("DATABASE_TEST_URL") ||
  `postgresql://${env("DB_USER") || "postgres"}:${env("DB_PASSWORD") || "postgres"}@localhost:${env("DB_TEST_PORT") || "5433"}/${env("DB_TEST_NAME") || "app_test"}`;

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    include: ["tests/integration/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup/integration-setup.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: testDbUrl,
      // The setup file resolves its own URL; hand it the same one explicitly.
      DATABASE_TEST_URL: testDbUrl,
      SESSION_SECRET: "integration-test-secret-minimum-32-characters",
      HONEYPOT_SECRET: "integration-test-honeypot-secret",
      RESEND_API_KEY: "test-resend-key",
      NODE_ENV: "test",
    },
  },
});
