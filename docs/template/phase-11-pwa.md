# Offline / PWA (Phase 11)

Phase 11 ships a progressive web app surface: a service worker with cache-first/network-first strategies, a manifest for installability, an IndexedDB sync queue for queued mutations, install + update prompts, an offline banner, and a standalone `/offline` fallback page.

## Feature flag

Everything is gated on `FEATURE_FLAG_KEYS.PWA` (key `FF_PWA`, already defined in Phase 3). When off:

- No `<link rel="manifest">` rendered
- No `<meta name="theme-color">` / `mobile-web-app-capable`
- Service worker is not registered
- Install + update prompts don't render

Flip the flag on once you've customized `public/manifest.json` + provided icons. The offline banner in `$tenant/_layout.tsx` always renders (it's zero-cost when `navigator.onLine` is true), so your tenant-scoped pages show a non-blocking banner on connection loss regardless.

## Service worker

`public/sw.js` — vanilla worker, no build step. Three named caches (`static-v1`, `api-v1`, `pages-v1`) with cleanup on `activate`. Routing:

- **Navigation requests (`request.mode === "navigate"`)** — network-first; on failure, serve the cached `/offline` page.
- **`/api/**`requests** — network-first; on failure, serve cached response or a JSON`{"error":"offline"}` shell.
- **Static assets** (JS/CSS/font/image/`/assets/**`/`/icons/**`) — cache-first.

Bump the `-v1` suffix on each of the three cache-name constants when you change routing behavior so old clients invalidate cleanly via the `activate` handler.

## Install + update prompts

- `~/components/pwa/install-prompt.tsx` — listens for `beforeinstallprompt`, shows a dismissable card ≤ 15 s, calls `prompt()` on Install.
- `~/components/pwa/sw-update-prompt.tsx` — listens for a new worker landing `installed` while a controller exists, posts `SKIP_WAITING`, reloads. Dismissable ≤ 30 s.

Both are rendered from `root.tsx` when `pwaEnabled` is true, so they appear above every surface without layout plumbing.

## Offline indicators

- `~/hooks/use-online-status.ts` — `useSyncExternalStore` over `online`/`offline` window events. Returns `true` on SSR.
- `~/components/offline-banner.tsx` — fixed-bottom yellow banner with `WifiOff` icon. Mounted in `$tenant/_layout.tsx`.
- `app/routes/offline.tsx` — full-page fallback at `/offline`. Rendered by the SW's navigation-fallback and precached on install.

## Sync queue

`~/utils/offline/sync-queue.ts` — small IndexedDB wrapper exposing `queueMutation`, `getQueuedMutations`, `removeMutation`. Intended pattern:

1. Mutation-side fetcher sees a network error → `queueMutation({ url, method, body })`.
2. Apps register a `"sync-mutations"` background-sync tag (`registration.sync.register("sync-mutations")`).
3. SW's `sync` handler broadcasts `{ type: "SYNC_REQUESTED" }` via `postMessage` to every open tab.
4. Client listens for that message → drains `getQueuedMutations()` → replays with `fetch()` → `removeMutation(id)` on success.

The replay loop itself is **not shipped** — each app knows how to re-issue its own requests (CSRF token refresh, redirects, error handling). This is infrastructure, not a turnkey system.

## Icons + manifest

Ship `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and `apple-touch-icon.png` (referenced in `manifest.json` + `root.tsx`). Template doesn't include real icons — generate them from your product logo before enabling `FF_PWA`.

Edit `public/manifest.json` to set `name`, `short_name`, `theme_color`, `background_color`.

## i18n

New namespace `pwa` (~12 keys, en + fr) registered in `~/utils/i18n.ts`.

## Deviations

- **Sync replay is caller-responsibility.** The template ships the queue + SW ping + message plumbing but not `replayQueuedMutations()`.
- **Service worker is hand-written JS, not Workbox.** Apps with complex caching needs can swap in Workbox or `vite-plugin-pwa`.
- **Icons aren't bundled.** Forking apps must ship their own maskable icon set.
- **No "Install" trigger for iOS.** `beforeinstallprompt` is Chromium-only.
- **No Workbox-style precache manifest.** `PRECACHE_URLS` in `sw.js` is hand-curated.
- **`theme-color` hardcoded to `#1e40af`** in `manifest.json` and `root.tsx`'s `<meta>`.
- **Offline banner uses `fixed bottom`** regardless of tenant layout height.
- **`registerServiceWorker` runs in an effect** (post-SSR). First visit may land on the cached `/offline` page only after a reload.
