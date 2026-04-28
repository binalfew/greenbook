import { createRequire } from "node:module";
import { defineConfig } from "prisma/config";

// Load .env files for local development convenience. dotenv is a
// devDependency, so `npm prune --omit=dev` removes it from the
// production runtime image — but the prisma CLI still loads this
// config at deploy time (e.g. `npx prisma db push` against the
// runtime image). A static `import "dotenv/config"` would fail to
// resolve and crash before defineConfig() runs; a try/catch around
// a dynamic require swallows the missing-module error in production
// where env vars come from docker's --env-file flag instead.
const requireOrSkip = createRequire(import.meta.url);
try {
  requireOrSkip("dotenv/config");
} catch {
  /* dotenv pruned from production build — env vars come from --env-file */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
