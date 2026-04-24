# Docs polish (Phase 15)

Phase 15 is the final phase — it's docs-only, closes out the extraction plan, and brings the template's front-door documentation in line with everything that landed across phases 0–14.

## Changes

- **`README.md` rewrite.** The Phase 0 README described only the base React Router scaffold; phases 1–14 added ~13 subsystems that weren't mentioned. The new README leads with a "What you get, out of the box" inventory (auth, multi-tenancy, SSO, privacy, PWA, etc.), a setup block that reflects the current docker-compose + seed flow, a project-layout tree covering all app/ subdirectories, the full command list, a feature-flag reference table with defaults, an env-var reference pointing to `.env.example`, and deployment notes.
- **`.env.example` completeness pass.** Added the optional operational vars that landed in phases 10 (`APP_URL`), 13 (`APP_NAME`, `APP_VERSION`, `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `CORS_ORIGINS`). Grouped as "Required" / "Optional" with inline comments.
- **`CLAUDE.md` intro refresh.** Rewrote "Template Scope" to reflect today's reality. Added a "Patterns by phase" jump table so new readers can find subsystem docs without scrolling the (then-monolithic) file. Replaced the "Patterns — coming in later phases" list (every bullet had shipped) with a "Core patterns reference" task-based quick index. Fleshed out the `app/utils/` subdirectory list.

## Deviations

- **No migration baseline added.** Still on `db push`.
- **No CONTRIBUTING.md, no CHANGELOG.md, no issue templates.** Opinionated template meant to be forked, not a shared library.
- **No LICENSE file shipped.** README mentions MIT-style terms but the actual LICENSE file isn't in the repo. First-time forks should add their chosen license immediately.
- **No architecture diagram.** The phases-by-table and per-phase sections substitute for one.
- **No upgrade / migration guide for apps already forked mid-extraction.**
- **`docs/superpowers/specs/2026-04-20-template-extraction-design.md`** is the original plan doc; kept for historical context.
