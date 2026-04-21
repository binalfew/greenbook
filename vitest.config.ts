import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Unit-test runner — isolated from the DB (MSW stubs outbound HTTP).
// Integration tests (hit a real Postgres on 5433) live in vitest.integration.config.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "build", "tests/e2e", "tests/integration"],
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup/unit-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "tests/coverage",
      exclude: ["node_modules", "build", "tests/**", "app/generated/**"],
    },
  },
});
