import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Integration-test runner — points at a separate Postgres on 5433 (see docker-compose).
// Each test starts with a fresh truncation; tests share the DB by running serially.
const testDbUrl =
  process.env.DATABASE_TEST_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@localhost:${process.env.DB_TEST_PORT || "5433"}/${process.env.DB_TEST_NAME || "app_test"}`;

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
      SESSION_SECRET: "integration-test-secret-minimum-32-characters",
      HONEYPOT_SECRET: "integration-test-honeypot-secret",
      RESEND_API_KEY: "test-resend-key",
      NODE_ENV: "test",
    },
  },
});
