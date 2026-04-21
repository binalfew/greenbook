import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.E2E_PORT) || 3001;
const E2E_BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;
const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@localhost:${process.env.DB_TEST_PORT || "5433"}/${process.env.DB_TEST_NAME || "app_test"}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/test-results",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["html", { outputFolder: "./tests/playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /smoke\.spec\.ts/,
    },
    {
      name: "smoke",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /smoke\.spec\.ts/,
    },
  ],
  webServer: {
    command: `DATABASE_URL="${TEST_DB_URL}" PORT=${E2E_PORT} npm run dev`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
