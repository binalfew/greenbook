# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the template's tooling, dependencies, folder structure, and formatting to the conventions that later phases will assume — without introducing any new features. After Phase 0 the template still builds, still serves the existing auth pages, but every file has moved to its final home and every tool (Prisma 7, Zod 4, Conform 1.19, vitest, Playwright, commitlint, husky, lint-staged) is installed and configured.

**Architecture:** Pure infrastructure change. No new routes, no new services, no schema changes. The `app/lib/` directory moves to `app/utils/` with subdirectories matching the facilities layout. Every tooling/formatting decision deferred in the master spec gets decided here (2-space + double quotes + semis + 100-width, matching facilities).

**Tech stack touched:** package.json, tsconfig, Prettier, commitlint, husky, lint-staged, Prisma 7, Zod 4, Conform 1.19, Docker Compose, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`

**Working directory:** `/Users/binalfew/Projects/templates/react-router`. **Never** run file-modifying commands against `/Users/binalfew/Projects/facilities`.

**Branch:** `phase-0-foundation` off `main`.

---

## Decisions locked in this phase

| Decision | Choice | Rationale |
|---|---|---|
| Indentation | 2-space | Matches facilities — all ported code will already conform |
| Quote style | Double quotes | Matches facilities |
| Semicolons | Yes | Matches facilities |
| Print width | 100 | Matches facilities |
| Prisma | v7.4.0 (from 6.16.2) | Facilities uses v7; blocker for porting services |
| Zod | v4.3.6 (from v3.25.76) | Facilities schemas use Zod v4 `z.string({ error: "..." })` |
| Conform | v1.19.0 (from v1.11.0) | Facilities' `useForm` stable-API wrapper depends on v1.19 |
| ID generator | Keep `@paralleldrive/cuid2` | No functional downside; avoids touching every model |
| Cuid default | Keep schema `@default(cuid())` where present | Migration-neutral |
| Docker | db + db-test (no Adminer) | Matches facilities; Prisma Studio replaces Adminer |
| Tabs → spaces reformat | Yes, whole codebase in one commit | Cleaner than per-file drift; only affects the template |
| `catalyst/` components | Leave alone this phase | Phase 5 concern |
| `@headlessui/react`, `@heroicons/react` | Leave alone this phase | Phase 5 concern |

---

## File-level impact map

**Files that change in Phase 0:**

- `package.json` — scripts, deps, devDeps
- `package-lock.json` — regenerated
- `.prettierrc` — format rules updated
- `tsconfig.json` — minor alignment
- `docker-compose.yml` — rewritten to add db-test, drop Adminer
- `.env.example` — add test DB URL, reorganize
- `prisma/schema.prisma` — only if Prisma 7 requires output-path tweaks
- `commitlint.config.ts` — **new**
- `.husky/pre-commit` — **new**
- `.husky/commit-msg` — **new**
- `.lintstagedrc.json` — **new**
- `vitest.config.ts` — **new** (minimal, runs against `tests/unit/`)
- `vitest.integration.config.ts` — **new** (points at test DB)
- `playwright.config.ts` — **new** (minimal)
- `tests/setup/setup-test-env.ts` — **new**
- `CLAUDE.md` — **new** at repo root
- Every file in `app/lib/` — moved to `app/utils/...`
- Every file under `app/` importing `~/lib/...` — import path rewritten to `~/utils/...`

**Files we DO NOT touch in Phase 0:**

- `app/components/**` — deferred to Phase 5
- `app/routes/**` except import path updates
- `prisma/schema.prisma` models — deferred to Phase 1 (schema rebuild)
- `prisma/seed.ts` — deferred to Phase 1
- `server/app.ts` — unless an import breaks; then minimal fix only

---

## New / Renamed folder structure after Phase 0

```
app/
  utils/
    auth/
      auth.server.ts          ← was lib/auth.server.ts
      csrf.server.ts          ← was lib/csrf.server.ts
      honeypot.server.ts      ← was lib/honeypot.server.ts
      permissions.server.ts   ← was lib/permission.server.ts
      session.server.ts       ← was lib/session.server.ts
      verification.server.ts  ← was lib/verification.server.ts
      user.ts                 ← was lib/user.ts
      constants.ts            ← was lib/constants.ts
    config/
      env.server.ts           ← was lib/env.server.ts
    db/
      db.server.ts            ← was lib/db.server.ts
    email/
      email.server.ts         ← was lib/email.server.ts
    monitoring/
      timing.server.ts        ← was lib/timing.server.ts
    client-hints.tsx          ← was lib/client-hints.tsx
    color-scheme.ts           ← was lib/color-scheme.ts
    headers.server.ts         ← was lib/headers.server.ts
    hints.ts                  ← was lib/hints.ts
    invariant.ts              ← was lib/invariant.ts
    misc.tsx                  ← was lib/utils.ts (renamed)
    nonce-provider.ts         ← was lib/nonce-provider.ts
    reduced-motion.ts         ← was lib/reduced-motion.ts
    request-info.ts           ← was lib/request-info.ts
    theme.server.ts           ← was lib/theme.server.ts
    time-zone.ts              ← was lib/time-zone.ts
    toast.server.ts           ← was lib/toast.server.ts
    types.ts                  ← was lib/types.ts
  components/
  routes/
  (app/lib/ removed)
tests/
  setup/
    setup-test-env.ts         ← NEW (empty scaffold)
  unit/                       ← NEW (empty)
  integration/                ← NEW (empty)
  e2e/                        ← NEW (empty)
```

---

## Pre-flight

### Task 0: Verify clean working state

**Files:** none.

- [ ] **Step 1: Verify facilities is clean** (must print "nothing to commit, working tree clean")

  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  ```

  Expected: `nothing to commit, working tree clean`. If dirty, STOP and report to user.

- [ ] **Step 2: Verify template is on `main` and clean**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```

  Expected: `nothing to commit, working tree clean` and current branch `main`.

- [ ] **Step 3: Create phase branch**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && git checkout -b phase-0-foundation
  ```

  Expected: `Switched to a new branch 'phase-0-foundation'`.

- [ ] **Step 4: Baseline build & typecheck**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

  Expected: zero errors. This is our green baseline. If there are errors at baseline, STOP and report — we need to know the delta.

---

## Task 1: Align Prettier config

**Files:**
- Modify: `/Users/binalfew/Projects/templates/react-router/.prettierrc`

- [ ] **Step 1: Replace `.prettierrc` with facilities-matching config**

  ```json
  {
    "semi": true,
    "singleQuote": false,
    "trailingComma": "all",
    "printWidth": 100,
    "tabWidth": 2,
    "useTabs": false,
    "arrowParens": "always",
    "endOfLine": "lf",
    "plugins": ["prettier-plugin-tailwindcss"]
  }
  ```

- [ ] **Step 2: Reformat the entire codebase**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prettier --write "app/**/*.{ts,tsx,css,json,md}" "prisma/**/*.{ts,prisma}" "server/**/*.ts" "*.{ts,tsx,json,md}"
  ```

  Expected: every file reformatted (tabs → 2 spaces, single → double quotes, add semicolons, widen to 100 cols).

- [ ] **Step 3: Verify typecheck still passes**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

  Expected: zero errors. Formatting is semantically neutral; a failure here means a non-formatting change snuck in.

- [ ] **Step 4: Commit when approved**

  Do NOT commit automatically. Show the diff summary to user (`git diff --stat`) and ask for approval. When approved:

  ```bash
  git add -A && git commit -m "chore(template): align Prettier config to 2-space + double quotes + 100 cols"
  ```

---

## Task 2: Align tsconfig

**Files:**
- Modify: `/Users/binalfew/Projects/templates/react-router/tsconfig.json`

- [ ] **Step 1: Replace `tsconfig.json` with facilities-matching version**

  ```json
  {
    "files": [],
    "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.vite.json" }],
    "compilerOptions": {
      "checkJs": true,
      "verbatimModuleSyntax": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "baseUrl": ".",
      "paths": {
        "~/*": ["./app/*"]
      }
    }
  }
  ```

  This drops `allowImportingTsExtensions` to match facilities. The template has one handwritten file with `.ts`-extension imports (`app/lib/permission.server.ts`, which imports `./auth.server.ts` and `./db.server.ts`). Generated files under `app/generated/prisma/**` also use extensions but are regenerated in Task 5 (Prisma 7 upgrade).

- [ ] **Step 2: Strip `.ts`/`.tsx` extensions from handwritten imports**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router

  # Handwritten files only — skip app/generated/
  find app/lib app/routes app/components server -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -E "s|from (['\"])([^'\"]+)\\.tsx?(['\"])|from \\1\\2\\3|g" \
    {} +
  ```

  This rewrites `from "./auth.server.ts"` → `from "./auth.server"` in all non-generated source files.

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: zero errors. If typecheck still complains about `.ts` imports inside `app/generated/**`, those are auto-generated and will disappear when Prisma regenerates them in Task 5. Temporary workaround: leave them; Prisma 7 client will overwrite the whole directory.

- [ ] **Step 4: Commit when approved**

  ```bash
  git add -A && git commit -m "chore(template): drop allowImportingTsExtensions and strip .ts import extensions"
  ```

---

## Task 3: Add dev tooling — commitlint, husky, lint-staged

**Files:**
- Create: `commitlint.config.ts`
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`
- Create: `.lintstagedrc.json`
- Modify: `package.json` (add devDeps + prepare script)

- [ ] **Step 1: Install dev deps**

  ```bash
  npm install -D @commitlint/cli@^20.4.1 @commitlint/config-conventional@^20.4.1 husky@^9.1.7 lint-staged@^16.2.7
  ```

  Expected: installs cleanly. Verify `package.json` now has all four under `devDependencies`.

- [ ] **Step 2: Add `prepare` script and ensure husky init runs**

  Edit `package.json` → `"scripts"` — add `"prepare": "husky"` and save. Then:

  ```bash
  npx husky init
  ```

  Expected: creates `.husky/` folder (may overwrite the default `pre-commit`).

- [ ] **Step 3: Write `commitlint.config.ts`**

  ```ts
  import type { UserConfig } from "@commitlint/types";

  const config: UserConfig = {
    extends: ["@commitlint/config-conventional"],
    rules: {
      "type-enum": [
        2,
        "always",
        [
          "feat",
          "fix",
          "docs",
          "style",
          "refactor",
          "perf",
          "test",
          "chore",
          "ci",
          "build",
          "revert",
        ],
      ],
      "subject-empty": [2, "never"],
      "subject-full-stop": [2, "never", "."],
      "subject-max-length": [2, "always", 100],
      "body-max-line-length": [2, "always", 200],
      "scope-case": [2, "always", "lower-case"],
    },
  };

  export default config;
  ```

- [ ] **Step 4: Write `.husky/pre-commit`**

  ```bash
  npx lint-staged
  ```

- [ ] **Step 5: Write `.husky/commit-msg`**

  ```bash
  npx --no -- commitlint --edit $1
  ```

  Make it executable:

  ```bash
  chmod +x .husky/pre-commit .husky/commit-msg
  ```

- [ ] **Step 6: Write `.lintstagedrc.json`**

  ```json
  {
    "*.{ts,tsx}": ["prettier --write"],
    "*.{json,yml,yaml,css,md}": ["prettier --write"],
    "*.prisma": ["npx prisma format --schema"]
  }
  ```

- [ ] **Step 7: Smoke test the hooks**

  Deliberately attempt a commit with a bad message to prove commitlint blocks it:

  ```bash
  git add -A
  git commit -m "BAD no type" || echo "commitlint correctly rejected"
  ```

  Expected: commit rejected by commit-msg hook. If it goes through, something's misconfigured — re-check `.husky/commit-msg`.

- [ ] **Step 8: Commit with a good message**

  ```bash
  git commit -m "chore(template): add commitlint + husky + lint-staged"
  ```

---

## Task 4: Update docker-compose and .env.example

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Rewrite `docker-compose.yml`**

  ```yaml
  services:
    db:
      image: postgres:16-alpine
      ports:
        - "${DB_PORT:-5432}:5432"
      environment:
        POSTGRES_USER: ${DB_USER:-postgres}
        POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
        POSTGRES_DB: ${DB_NAME:-app}
      volumes:
        - pgdata:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres}"]
        interval: 5s
        timeout: 5s
        retries: 5
      networks:
        - app-network

    db-test:
      image: postgres:16-alpine
      ports:
        - "${DB_TEST_PORT:-5433}:5432"
      environment:
        POSTGRES_USER: ${DB_USER:-postgres}
        POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
        POSTGRES_DB: ${DB_TEST_NAME:-app_test}
      tmpfs:
        - /var/lib/postgresql/data
      networks:
        - app-network

  volumes:
    pgdata:

  networks:
    app-network:
      driver: bridge
  ```

- [ ] **Step 2: Rewrite `.env.example`**

  ```bash
  # Runtime
  NODE_ENV=development

  # Database (matches docker-compose defaults)
  DB_USER=postgres
  DB_PASSWORD=postgres
  DB_NAME=app
  DB_PORT=5432
  DB_TEST_NAME=app_test
  DB_TEST_PORT=5433
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app?schema=public"
  DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5433/app_test?schema=public"

  # Auth
  SESSION_SECRET=change-me-in-production
  HONEYPOT_SECRET=change-me-in-production

  # Email (dev: uses Resend mocks in mocks/)
  RESEND_API_KEY=dev-key

  # Misc
  MOCKS=true
  ```

- [ ] **Step 3: Add Docker scripts to `package.json`**

  In `"scripts"` block, add/update:

  ```json
  "docker:up": "docker compose up -d",
  "docker:down": "docker compose down",
  "docker:db:reset": "docker compose exec db psql -U postgres -c 'DROP DATABASE IF EXISTS app;' -c 'CREATE DATABASE app;' && npm run db:push"
  ```

- [ ] **Step 4: Smoke test Docker**

  ```bash
  docker compose down -v 2>/dev/null; npm run docker:up && sleep 3 && docker compose ps
  ```

  Expected: both `db` and `db-test` services running. If the old postgres container (`db`, `adminer_ui`) is still referenced, the `down -v` cleared it.

- [ ] **Step 5: Commit when approved**

  ```bash
  git add docker-compose.yml .env.example package.json package-lock.json && git commit -m "chore(template): align docker-compose + env with facilities pattern"
  ```

---

## Task 5: Upgrade Prisma 6 → 7

**Files:**
- Modify: `package.json`
- Modify: `prisma/schema.prisma` (only if needed)

- [ ] **Step 1: Bump Prisma packages**

  ```bash
  npm install @prisma/client@^7.4.0 && npm install -D prisma@^7.4.0
  ```

  Also add the PostgreSQL adapter that facilities uses:

  ```bash
  npm install @prisma/adapter-pg@^7.4.0 pg@^8.18.0 && npm install -D @types/pg@^8.16.0
  ```

- [ ] **Step 2: Verify schema provider path**

  Open `prisma/schema.prisma`. The template uses:

  ```prisma
  generator client {
    provider = "prisma-client"
    output   = "../app/generated/prisma"
  }
  ```

  Prisma 7 supports this. **No schema change needed.** If Prisma 7 complains about the `output` path convention, update to `"../app/generated/prisma"` (unchanged) and re-run.

- [ ] **Step 3: Regenerate client**

  ```bash
  npx prisma generate
  ```

  Expected: client generates into `app/generated/prisma/`. If the output directory structure changed (e.g., client file is now `client.ts` vs `index.ts`), note the new path — imports may need updating in Step 5.

- [ ] **Step 4: Update `db.server.ts` if driver import changed**

  Open `app/lib/db.server.ts`. If it imports `PrismaClient` from the old path (e.g., `@prisma/client`) and this no longer resolves, update to import from the generated path:

  ```ts
  import { PrismaClient } from "~/generated/prisma/client";
  ```

  Add the adapter wiring only if the existing file uses it. In Phase 0, keep scope minimal — if the existing direct client still works, leave it.

- [ ] **Step 5: Typecheck & build**

  ```bash
  npm run typecheck && npm run build
  ```

  Expected: both succeed. Fix any type errors surfaced by the Prisma 7 types (likely: stricter query arg types, removal of deprecated methods). Keep fixes surgical.

- [ ] **Step 6: Apply schema to dev DB**

  ```bash
  npm run db:push
  ```

  Expected: no migration errors. The template's seed script isn't run here (Phase 1 concern).

- [ ] **Step 7: Commit when approved**

  ```bash
  git add -A && git commit -m "feat(template): upgrade to Prisma 7 + @prisma/adapter-pg"
  ```

---

## Task 6: Upgrade Zod 3 → 4 and Conform 1.11 → 1.19

**Files:**
- Modify: `package.json`
- Modify: any file using Zod's v3 error API

- [ ] **Step 1: Bump Zod and Conform packages**

  ```bash
  npm install zod@^4.3.6 @conform-to/react@^1.19.0 @conform-to/zod@^1.19.0
  ```

- [ ] **Step 2: Rewrite Zod v3 error kwargs to v4 unified `error`**

  Zod v4 removed `{ required_error, invalid_type_error }` in favor of `{ error: "..." }`. The template has **11 occurrences across 5 auth route files**: `signup.tsx`, `login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `onboarding.tsx`.

  Rewrite each occurrence by hand (the collapse from two kwargs into one isn't safe to sed). For each match:

  ```ts
  // v3:
  z.string({ required_error: "Email is required", invalid_type_error: "Must be a string" })
  // v4:
  z.string({ error: "Email is required" })

  // v3 with just required_error:
  z.string({ required_error: "Password is required" })
  // v4:
  z.string({ error: "Password is required" })
  ```

  Prefer `required_error`'s message when both exist — that's the user-facing "missing" message. `invalid_type_error` was rarely user-meaningful.

  To confirm all are rewritten:

  ```bash
  grep -rn "required_error\|invalid_type_error" app
  ```

  Expected: zero hits after rewrite.

- [ ] **Step 3: Identify Conform API breakage**

  Conform 1.11 → 1.19 is mostly additive. The main risk: any hand-rolled types referencing internals. Typecheck will surface these.

- [ ] **Step 4: Typecheck + build**

  ```bash
  npm run typecheck && npm run build
  ```

  Expected: both succeed. Fix inline any errors. **Do NOT attempt large refactors** — if a Conform call pattern needs a meaningful rewrite (e.g., adopting the stable `useForm` wrapper), defer that to Phase 5 (components library).

- [ ] **Step 5: Run dev server smoke test**

  ```bash
  npm run dev &
  SERVER_PID=$!
  sleep 5
  curl -sf http://localhost:3000/ > /dev/null && echo "home OK" || echo "home FAIL"
  curl -sf http://localhost:3000/login > /dev/null && echo "login OK" || echo "login FAIL"
  kill $SERVER_PID
  ```

  Expected: "home OK" and "login OK". If either fails, inspect the server output and fix before continuing.

- [ ] **Step 6: Commit when approved**

  ```bash
  git add -A && git commit -m "feat(template): upgrade Zod to v4 and Conform to v1.19"
  ```

---

## Task 7: Reorganize `app/lib/` → `app/utils/` with subdirectories

**Files:** every file under `app/lib/` + every file importing `~/lib/...`.

This is the highest-risk task in Phase 0. Do it as a single atomic change.

- [ ] **Step 1: Create target directory structure**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router
  mkdir -p app/utils/auth app/utils/db app/utils/email app/utils/config app/utils/monitoring
  ```

- [ ] **Step 2: Move files into subdirectories**

  ```bash
  git mv app/lib/auth.server.ts         app/utils/auth/auth.server.ts
  git mv app/lib/session.server.ts      app/utils/auth/session.server.ts
  git mv app/lib/csrf.server.ts         app/utils/auth/csrf.server.ts
  git mv app/lib/honeypot.server.ts     app/utils/auth/honeypot.server.ts
  git mv app/lib/verification.server.ts app/utils/auth/verification.server.ts
  git mv app/lib/permission.server.ts   app/utils/auth/permissions.server.ts
  git mv app/lib/user.ts                app/utils/auth/user.ts
  git mv app/lib/constants.ts           app/utils/auth/constants.ts
  git mv app/lib/db.server.ts           app/utils/db/db.server.ts
  git mv app/lib/email.server.ts        app/utils/email/email.server.ts
  git mv app/lib/env.server.ts          app/utils/config/env.server.ts
  git mv app/lib/timing.server.ts       app/utils/monitoring/timing.server.ts
  ```

- [ ] **Step 3: Move top-level util files**

  ```bash
  git mv app/lib/client-hints.tsx   app/utils/client-hints.tsx
  git mv app/lib/color-scheme.ts    app/utils/color-scheme.ts
  git mv app/lib/headers.server.ts  app/utils/headers.server.ts
  git mv app/lib/hints.ts           app/utils/hints.ts
  git mv app/lib/invariant.ts       app/utils/invariant.ts
  git mv app/lib/nonce-provider.ts  app/utils/nonce-provider.ts
  git mv app/lib/reduced-motion.ts  app/utils/reduced-motion.ts
  git mv app/lib/request-info.ts    app/utils/request-info.ts
  git mv app/lib/theme.server.ts    app/utils/theme.server.ts
  git mv app/lib/time-zone.ts       app/utils/time-zone.ts
  git mv app/lib/toast.server.ts    app/utils/toast.server.ts
  git mv app/lib/types.ts           app/utils/types.ts
  git mv app/lib/utils.ts           app/utils/misc.tsx
  ```

  Note the rename `utils.ts → misc.tsx` to match facilities. The file contains React hooks (`useNavigation`, `useFormAction`) so it must be `.tsx`.

- [ ] **Step 4: Remove the empty `lib` directory**

  ```bash
  rmdir app/lib 2>/dev/null || true
  ```

- [ ] **Step 5: Rewrite intra-utils imports**

  Inside the moved files, imports like `./db.server` or `./session.server` no longer resolve because files have moved to different subdirs. Systematically update them.

  Use this mapping to rewrite each relative import inside `app/utils/**`:

  | Old | New path from `auth/` | New path from `db/` | New path from `email/` | New path from `config/` | New path from `monitoring/` | New path from top-level `utils/` |
  |---|---|---|---|---|---|---|
  | `./db.server` | `../db/db.server` | `./db.server` | `../db/db.server` | `../db/db.server` | `../db/db.server` | `./db/db.server` |
  | `./session.server` | `./session.server` | `../auth/session.server` | — | — | — | `./auth/session.server` |
  | `./auth.server` | `./auth.server` | `../auth/auth.server` | — | — | — | `./auth/auth.server` |
  | `./constants` | `./constants` | `../auth/constants` | — | — | — | `./auth/constants` |
  | `./user` | `./user` | `../auth/user` | — | — | — | `./auth/user` |
  | `./email.server` | `../email/email.server` | `../email/email.server` | `./email.server` | — | — | `./email/email.server` |
  | `./verification.server` | `./verification.server` | — | — | — | — | `./auth/verification.server` |
  | `./env.server` | `../config/env.server` | `../config/env.server` | `../config/env.server` | `./env.server` | `../config/env.server` | `./config/env.server` |
  | `./utils` | `../misc` | `../misc` | `../misc` | `../misc` | `../misc` | `./misc` |
  | `./types` | `../types` | `../types` | `../types` | `../types` | `../types` | `./types` |
  | `./invariant` | `../invariant` | `../invariant` | `../invariant` | `../invariant` | `../invariant` | `./invariant` |
  | `./honeypot.server` | `./honeypot.server` | — | — | — | — | `./auth/honeypot.server` |

  **Concrete rewrite commands** (use sed with macOS BSD syntax `-i ''`):

  ```bash
  cd /Users/binalfew/Projects/templates/react-router

  # Files in utils/auth/
  find app/utils/auth -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e "s|from \"./db.server\"|from \"../db/db.server\"|g" \
    -e "s|from \"./email.server\"|from \"../email/email.server\"|g" \
    -e "s|from \"./env.server\"|from \"../config/env.server\"|g" \
    -e "s|from \"./utils\"|from \"../misc\"|g" \
    -e "s|from \"./types\"|from \"../types\"|g" \
    -e "s|from \"./invariant\"|from \"../invariant\"|g" \
    {} +

  # Files in utils/db/
  find app/utils/db -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e "s|from \"./env.server\"|from \"../config/env.server\"|g" \
    -e "s|from \"./utils\"|from \"../misc\"|g" \
    {} +

  # Files in utils/email/
  find app/utils/email -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e "s|from \"./env.server\"|from \"../config/env.server\"|g" \
    -e "s|from \"./utils\"|from \"../misc\"|g" \
    {} +

  # Files in utils/config/
  find app/utils/config -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e "s|from \"./utils\"|from \"../misc\"|g" \
    {} +

  # Files in utils/monitoring/
  find app/utils/monitoring -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e "s|from \"./utils\"|from \"../misc\"|g" \
    {} +
  ```

  Note: single-quoted import paths (`'./db.server'`) were converted to double quotes in Task 1, so we only need to match double-quoted paths here.

- [ ] **Step 6: Rewrite `~/lib/...` imports across app/**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router

  # Auth subdir
  grep -rl "from \"~/lib/auth.server\""        app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/auth.server"|from "~/utils/auth/auth.server"|g'
  grep -rl "from \"~/lib/session.server\""     app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/session.server"|from "~/utils/auth/session.server"|g'
  grep -rl "from \"~/lib/csrf.server\""        app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/csrf.server"|from "~/utils/auth/csrf.server"|g'
  grep -rl "from \"~/lib/honeypot.server\""    app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/honeypot.server"|from "~/utils/auth/honeypot.server"|g'
  grep -rl "from \"~/lib/verification.server\"" app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/verification.server"|from "~/utils/auth/verification.server"|g'
  grep -rl "from \"~/lib/permission.server\"" app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/permission.server"|from "~/utils/auth/permissions.server"|g'
  grep -rl "from \"~/lib/user\""              app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/user"|from "~/utils/auth/user"|g'
  grep -rl "from \"~/lib/constants\""         app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/constants"|from "~/utils/auth/constants"|g'

  # db, email, config, monitoring
  grep -rl "from \"~/lib/db.server\""         app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/db.server"|from "~/utils/db/db.server"|g'
  grep -rl "from \"~/lib/email.server\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/email.server"|from "~/utils/email/email.server"|g'
  grep -rl "from \"~/lib/env.server\""        app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/env.server"|from "~/utils/config/env.server"|g'
  grep -rl "from \"~/lib/timing.server\""     app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/timing.server"|from "~/utils/monitoring/timing.server"|g'

  # Top-level utils
  grep -rl "from \"~/lib/client-hints\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/client-hints"|from "~/utils/client-hints"|g'
  grep -rl "from \"~/lib/color-scheme\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/color-scheme"|from "~/utils/color-scheme"|g'
  grep -rl "from \"~/lib/headers.server\""    app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/headers.server"|from "~/utils/headers.server"|g'
  grep -rl "from \"~/lib/hints\""             app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/hints"|from "~/utils/hints"|g'
  grep -rl "from \"~/lib/invariant\""         app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/invariant"|from "~/utils/invariant"|g'
  grep -rl "from \"~/lib/nonce-provider\""    app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/nonce-provider"|from "~/utils/nonce-provider"|g'
  grep -rl "from \"~/lib/reduced-motion\""    app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/reduced-motion"|from "~/utils/reduced-motion"|g'
  grep -rl "from \"~/lib/request-info\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/request-info"|from "~/utils/request-info"|g'
  grep -rl "from \"~/lib/theme.server\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/theme.server"|from "~/utils/theme.server"|g'
  grep -rl "from \"~/lib/time-zone\""         app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/time-zone"|from "~/utils/time-zone"|g'
  grep -rl "from \"~/lib/toast.server\""      app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/toast.server"|from "~/utils/toast.server"|g'
  grep -rl "from \"~/lib/types\""             app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/types"|from "~/utils/types"|g'
  grep -rl "from \"~/lib/utils\""             app --include="*.ts" --include="*.tsx" | xargs -r sed -i '' 's|from "~/lib/utils"|from "~/utils/misc"|g'
  ```

- [ ] **Step 7: Rewrite imports in `server/` if it imports from `~/lib/...`**

  ```bash
  grep -rln "~/lib/" /Users/binalfew/Projects/templates/react-router/server
  ```

  If any matches, apply the same sed rewrites scoped to `server/`.

- [ ] **Step 8: Final sanity check — no `~/lib/` imports remain**

  ```bash
  grep -rn "~/lib/" /Users/binalfew/Projects/templates/react-router/app /Users/binalfew/Projects/templates/react-router/server
  ```

  Expected: zero hits. If any remain, rewrite manually.

- [ ] **Step 9: Typecheck + build + dev smoke**

  ```bash
  npm run typecheck && npm run build
  ```

  Expected: zero errors. Any "Cannot find module '~/lib/…'" means Step 8 missed a path — fix and re-run.

  Then:

  ```bash
  npm run dev &
  SERVER_PID=$!
  sleep 5
  curl -sfI http://localhost:3000/ | head -1
  curl -sfI http://localhost:3000/login | head -1
  kill $SERVER_PID
  ```

  Expected: two `HTTP/1.1 200 OK` or `302 Found` responses.

- [ ] **Step 10: Commit when approved**

  ```bash
  git add -A && git commit -m "refactor(template): reorganize app/lib into app/utils with subdirs (auth, db, email, config, monitoring)"
  ```

---

## Task 8: Align package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `"scripts"` block with the facilities-aligned version**

  Keep only scripts whose dependencies exist after Phase 0. Scripts for features that arrive in later phases (integration tests, E2E tests, migrations, seed) are declared but may no-op today — they'll work once the subject phase lands.

  ```json
  {
    "scripts": {
      "build": "react-router build",
      "dev": "cross-env NODE_ENV=development node server.js",
      "start": "node server.js",
      "typecheck": "react-router typegen && tsc -b",
      "lint": "tsc -b --noEmit",
      "format": "prettier --write .",
      "prepare": "husky",
      "docker:up": "docker compose up -d",
      "docker:down": "docker compose down",
      "docker:db:reset": "docker compose exec db psql -U postgres -c 'DROP DATABASE IF EXISTS app;' -c 'CREATE DATABASE app;' && npm run db:push",
      "db:generate": "prisma generate",
      "db:migrate": "npx prisma migrate dev",
      "db:push": "npx prisma db push",
      "db:seed": "npx prisma db seed",
      "db:studio": "npx prisma studio",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:coverage": "vitest run --coverage",
      "test:integration": "vitest run --config vitest.integration.config.ts",
      "test:e2e": "playwright test",
      "test:e2e:ui": "playwright test --ui"
    }
  }
  ```

- [ ] **Step 2: Typecheck + build**

  ```bash
  npm run typecheck && npm run build
  ```

- [ ] **Step 3: Commit when approved**

  ```bash
  git add package.json && git commit -m "chore(template): align npm scripts with facilities conventions"
  ```

---

## Task 9: Testing scaffold (vitest + Playwright, no tests yet)

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup/setup-test-env.ts`
- Create: `tests/unit/.gitkeep`
- Create: `tests/integration/.gitkeep`
- Create: `tests/e2e/.gitkeep`
- Modify: `package.json` (add deps from earlier + `@playwright/test`)

- [ ] **Step 1: Install test deps**

  ```bash
  npm install -D vitest@^4.0.18 @vitest/coverage-v8@^4.0.18 @playwright/test@^1.58.2
  ```

- [ ] **Step 2: Write `vitest.config.ts`**

  ```ts
  import { defineConfig } from "vitest/config";
  import tsconfigPaths from "vite-tsconfig-paths";

  export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
      include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
      setupFiles: ["./tests/setup/setup-test-env.ts"],
      environment: "node",
      globals: false,
    },
  });
  ```

  We start with `environment: "node"`. Component tests (which need `happy-dom` or `jsdom`) arrive with the components phase; install the DOM env then.

- [ ] **Step 3: Write `vitest.integration.config.ts`**

  ```ts
  import { defineConfig } from "vitest/config";
  import tsconfigPaths from "vite-tsconfig-paths";

  export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
      include: ["tests/integration/**/*.test.ts"],
      setupFiles: ["./tests/setup/setup-test-env.ts"],
      environment: "node",
      globals: false,
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 30_000,
    },
  });
  ```

- [ ] **Step 4: Write `tests/setup/setup-test-env.ts`**

  ```ts
  // Centralized test env bootstrap.
  // Individual test suites add DB seed/teardown in later phases.
  import { beforeAll } from "vitest";

  beforeAll(() => {
    // placeholder — populated in later phases as subsystems arrive
  });
  ```

- [ ] **Step 5: Write `playwright.config.ts`**

  ```ts
  import { defineConfig, devices } from "@playwright/test";

  export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? "github" : "list",
    use: {
      baseURL: "http://localhost:3000",
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  });
  ```

- [ ] **Step 6: Create empty test directories with `.gitkeep`**

  ```bash
  mkdir -p tests/unit tests/integration tests/e2e tests/setup
  touch tests/unit/.gitkeep tests/integration/.gitkeep tests/e2e/.gitkeep
  ```

- [ ] **Step 7: Verify the commands run (green with zero tests)**

  ```bash
  npm run test
  ```

  Expected: "No test files found" — vitest exits 0 or reports no files. That's acceptable for Phase 0.

  ```bash
  npx playwright install chromium
  # (first-time browser download; OK to skip if already installed)
  ```

- [ ] **Step 8: Commit when approved**

  ```bash
  git add -A && git commit -m "chore(template): scaffold vitest + Playwright test harness (no tests yet)"
  ```

---

## Task 10: Write initial CLAUDE.md

**Files:**
- Create: `CLAUDE.md` at repo root

- [ ] **Step 1: Write `CLAUDE.md` covering Phase 0 reality only**

  Do not document features that don't exist yet. Forward-reference only with "(coming in Phase N)" markers when it clarifies intent.

  ```markdown
  # CLAUDE.md

  This file provides guidance to Claude Code (claude.ai/code) when working with this template.

  ## Template scope

  This is a **living template** for building full-stack React Router apps. It ships the domain-agnostic plumbing (auth, data access, forms, UI primitives, testing). Business domains go in forks.

  Future phases (see `docs/superpowers/specs/2026-04-20-template-extraction-design.md`) will add RBAC helpers, multi-tenancy shell, settings + feature flags, i18n, events/jobs, saved views, custom fields, privacy, SSO, PWA, and a demo Notes entity. **Today** (Phase 0) the template only has the baseline auth flow, upgraded dependencies, and the folder structure those phases will fill in.

  ## Build & Development Commands

  ```bash
  npm run dev              # Start dev server (Express + React Router)
  npm run build            # Production build
  npm run start            # Production server
  npm run typecheck        # react-router typegen && tsc -b
  npm run lint             # tsc -b --noEmit
  npm run format           # Prettier format all files
  ```

  ### Database

  ```bash
  npm run docker:up        # Start Postgres (dev + test)
  npm run db:push          # Sync Prisma schema to DB
  npm run db:seed          # Seed database (when a seed script lands in later phases)
  npm run db:studio        # Prisma Studio GUI
  ```

  ### Testing

  ```bash
  npm run test             # Unit tests (vitest)
  npm run test:integration # Integration tests against test DB (port 5433)
  npm run test:e2e         # Playwright E2E
  ```

  Test directories are scaffolded empty — tests arrive with their subject phases.

  ## Architecture

  ### Stack

  - **Framework:** React Router 7 with SSR, Express server, Vite bundler
  - **Database:** PostgreSQL via Prisma 7 (with `@prisma/adapter-pg`)
  - **UI:** shadcn/ui + Radix primitives + Tailwind CSS 4 + lucide-react
  - **Forms:** Conform (`@conform-to/react` + `@conform-to/zod`) with Zod v4
  - **Auth:** Cookie-based sessions with DB backing

  ### Project Layout

  - `app/routes/` — File-based routing via `react-router-auto-routes`. Folders prefixed with `+` are ignored (use for `+shared/` editor patterns).
  - `app/components/ui/` — shadcn/ui components (do not edit; use `npx shadcn add`).
  - `app/components/` — Custom components.
  - `app/utils/` — Core utilities, organized into subdirectories. Files ending in `.server.ts` are server-only.
    - `app/utils/auth/` — session, verification, CSRF, honeypot, user helpers
    - `app/utils/db/` — Prisma client
    - `app/utils/email/` — email sending
    - `app/utils/config/` — environment variables
    - `app/utils/monitoring/` — timing/profiling
  - `server/` — Express app setup.
  - `prisma/schema.prisma` — Database schema.
  - `tests/` — unit, integration, e2e.

  Path alias: `~/*` maps to `./app/*`.

  ## Code Conventions

  - **Formatting:** Prettier — double quotes, semicolons, trailing commas, 100-char width, 2-space indent.
  - **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`. Max subject 100 chars.
  - **Pre-commit:** Husky + lint-staged runs Prettier on staged files and formats Prisma schema.
  - **Server-only code:** Use `.server.ts` suffix — these files are excluded from client bundles.
  - **Node version:** 22.

  ## Patterns — coming in later phases

  The facilities application that this template was extracted from established several patterns (entity route structure with trailing-underscore escapes, shared editor + `+shared/` folders, cascading dropdowns via `useCascade`, dialog route pattern, action error-handling via Conform `submission.reply()`, 2/3 + 1/3 detail layouts). These are not in the template yet — they arrive in Phases 1–15 alongside the code that exercises them. See `docs/superpowers/specs/2026-04-20-template-extraction-design.md` for the full plan.
  ```

- [ ] **Step 2: Format + verify**

  ```bash
  npx prettier --write CLAUDE.md && npm run typecheck
  ```

- [ ] **Step 3: Commit when approved**

  ```bash
  git add CLAUDE.md && git commit -m "docs(template): add CLAUDE.md covering Phase 0 state"
  ```

---

## Task 11: Final Phase 0 validation

No files touched — this task only verifies nothing is broken.

- [ ] **Step 1: Facilities must be unchanged**

  ```bash
  cd /Users/binalfew/Projects/facilities && git status && git diff --stat
  ```

  Expected: `nothing to commit, working tree clean` and empty diff stat. If dirty, STOP — investigate and roll back the offending change.

- [ ] **Step 2: Template typecheck**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

  Expected: zero errors.

- [ ] **Step 3: Template build**

  ```bash
  npm run build
  ```

  Expected: builds cleanly into `build/`.

- [ ] **Step 4: Prisma status**

  ```bash
  npm run docker:up
  npm run db:push
  ```

  Expected: schema applies to dev DB without errors.

- [ ] **Step 5: Test harness smoke**

  ```bash
  npm run test
  ```

  Expected: "No test files found" or exits 0. Test files land in later phases.

- [ ] **Step 6: Dev smoke**

  ```bash
  npm run dev &
  SERVER_PID=$!
  sleep 5
  for path in / /login /signup /forgot-password; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$path")
    echo "$path → $code"
  done
  kill $SERVER_PID
  ```

  Expected: each route responds 200 or 302. 404/500 indicates an import path broke during reorg.

- [ ] **Step 7: Hook smoke**

  Test the commit hook still works:

  ```bash
  git commit --allow-empty -m "BAD no type" || echo "commitlint blocked — good"
  git commit --allow-empty -m "chore(template): hook smoke"
  git reset --hard HEAD~1  # undo the smoke commit
  ```

  Expected: bad message rejected, good message accepted. Reset the smoke commit afterwards.

- [ ] **Step 8: Phase summary for user**

  Write a 200-word-max summary of what changed and what the next phase will do. Show `git log --oneline main..phase-0-foundation` so the user sees the phase's commits.

- [ ] **Step 9: Ask user whether to merge Phase 0 or proceed as a PR**

  Possible answers:
  - **Merge to main now** → `git checkout main && git merge --no-ff phase-0-foundation && git push`
  - **Open a PR and let me review** → `git push -u origin phase-0-foundation`
  - **Leave as-is on the branch** → stop here; Phase 1 starts on top of this branch

  Do not execute any of the above without explicit user approval.

---

## Rollback plan

If any task goes sideways:

- Within a task: `git checkout -- <file>` or `git reset HEAD <file>`.
- Undo last commit on this branch: `git reset --soft HEAD~1` (keeps changes staged; lets you fix and recommit).
- Start the phase over: `git checkout main && git branch -D phase-0-foundation && git checkout -b phase-0-foundation`.
- **Never** run `git reset --hard` without user approval (destroys uncommitted work).

---

## Out of scope for Phase 0 (deferred)

- Catalyst components removal → Phase 5
- `@headlessui/react` / `@heroicons/react` → Phase 5
- `@epic-web/cachified` → either keep or swap in Phase 7
- Existing schema rebuild (adding enums, join tables, audit, indexes) → Phase 1
- Seed script rewrite → Phase 1
- Server hardening (correlation IDs, rate limit, Sentry) → Phase 13
- Any new routes, services, or components → subject phases
