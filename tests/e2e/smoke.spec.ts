import { expect, test } from "@playwright/test";

// Smoke test — verifies the app boots and serves the login page.
// Runs in the "smoke" project (ignored by chromium default).
test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
});
