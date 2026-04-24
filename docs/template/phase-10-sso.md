# SSO (Phase 10)

Phase 10 adds enterprise SSO — both OpenID Connect (OIDC) and SAML 2.0 — with full tenant-scoped admin UI and the authentication flow wired end-to-end.

## Packages

- `openid-client@^6` — OIDC discovery + PKCE + token exchange.
- `samlify@^2` — SAML 2.0 AuthnRequest generation + Response validation + attribute extraction.

## Schema

Two new tenant-scoped models + two enums added to `prisma/schema.prisma`:

- `SSOProvider` enum — `OKTA` / `AZURE_AD` / `GOOGLE` / `CUSTOM_OIDC` / `CUSTOM_SAML`.
- `SSOProtocol` enum — `OIDC` / `SAML`.
- `SSOConfiguration` — one row per IdP per tenant. Stores OIDC fields (`clientId`, `clientSecret`, `issuerUrl`, `metadataUrl`), SAML fields (`ssoUrl`, `x509Certificate`, `spEntityId`, `nameIdFormat`), plus `callbackUrl`, `autoProvision`, `enforceSSO`, `defaultRoleId`, `isActive`.
- `SSOConnection` — one row per (user, provider, tenant). Tracks the IdP's `providerUserId` + last login.

Back-relations: `Tenant.ssoConfigurations`, `Tenant.ssoConnections`, `User.ssoConnections`. Applied via `db push --accept-data-loss` (no migration file — template workflow).

## Utilities

- `~/utils/auth/oidc.server.ts` — openid-client v6 wrapper. Exports `discoverOIDCProvider` (cached 10 min), PKCE helpers (`generateCodeVerifier`, `generateCodeChallenge`), `generateState`, `generateNonce`, `buildAuthorizationUrl`, `exchangeCodeForClaims`, and a dry-run `testOIDCDiscovery` for the "Test Connection" button.
- `~/utils/auth/saml.server.ts` — samlify wrapper. Exports `buildSAMLRedirectUrl`, `validateSAMLResponse`, `generateRequestId`, `generateSAMLState`, `testSAMLConfiguration`. `samlify.setSchemaValidator` is set to permissive (signature validation still runs internally via xml-crypto).
- `~/utils/auth/sso-state.server.ts` — short-lived (10-min) cookie session storage (`__sso_state`) plus HMAC-signed SAML RelayState encoding. The SAML path encodes flow state into `RelayState` instead of cookies because SAML IdPs POST back cross-origin and `sameSite=lax` cookies don't traverse that.
- `~/utils/schemas/sso.ts` — `createSSOConfigSchema` Zod validator covering both protocols' fields (all optional-per-protocol, service enforces required subset).
- `~/utils/constants/sso.ts` — `SSO_PROVIDER_OPTIONS`, `SSO_PROTOCOL_OPTIONS`, `IDP_INSTRUCTIONS` (setup guides per provider, including Okta-SAML + Azure-AD-SAML variants).

## Service

`~/services/sso.server.ts` (~680 lines):

- **CRUD:** `getSSOConfigurations(tenantId)`, `getSSOConfigById`, `createSSOConfiguration`, `updateSSOConfiguration` (preserves `clientSecret` when not provided), `deleteSSOConfiguration`, `getSSOConnectionCount*`.
- **Test:** `testSSOConfiguration(id)` — dispatches to `testOIDCDiscovery` or `testSAMLConfiguration` based on protocol. Returns `{ success, error? }`.
- **Flow initiation:** `initiateSSOFlow(configId, tenantSlug, redirectTo)` — builds authorization URL + captures state/nonce/PKCE/requestId; caller persists flow state via cookie (OIDC) or RelayState (SAML).
- **Callback:** `handleSSOCallback({ protocol, ...params })` — dispatches to `handleOIDCCallback` (exchanges code for claims, calls `resolveOrProvisionUser`) or `handleSAMLCallback` (validates SAML Response, extracts `nameId`/email/name).
- **Linking:** `linkSSOAccount` / `linkSAMLAccount` — adds an `SSOConnection` row for an already-authenticated user without creating a new session.
- **User resolution (`resolveOrProvisionUser`):** (1) existing `SSOConnection` → update last-login, check `userStatus.code === "ACTIVE"`, check tenant; (2) existing user by case-insensitive email → create connection, guard cross-tenant; (3) auto-provision iff `autoProvision` is true — creates user with `userStatusId` → ACTIVE, splits the IdP `name` claim into `firstName`/`lastName`, optionally assigns `defaultRoleId`. All inside a `$transaction`.

## Routes

**Authentication flow** (under `_auth/` → URL-visible at `/sso/*`, no tenant prefix):

- `/sso/start?tenant=<slug>&configId=<id>[&link=true]` — loader-only redirect. Looks up the SSO config, mints PKCE/state, stores flow state (cookie for OIDC, signed RelayState for SAML), redirects to the IdP.
- `/sso/callback` — GET loader handles OIDC; POST action handles SAML (cross-origin POST from the IdP). Validates state/nonce, exchanges code (OIDC) or validates Response (SAML), writes a `LOGIN` audit entry via `writeAudit`, deletes any existing user sessions (single-session model), creates a new `Session` row, sets the `sessionKey` cookie, redirects to `flowState.redirectTo || /<tenantSlug>`. Renders a standalone "Sign-in Failed" page when the callback rejects.

**Admin** (under `$tenant/settings/sso/`):

- `index.tsx` — DataTable with provider/protocol/status columns, search across displayName/provider/issuerUrl, filters for protocol + active/inactive, connection-count per provider (via `groupBy`).
- `new.tsx` — full form with OIDC Configuration + SAML Configuration + Provisioning cards; setup-guide accordion shows per-provider IdP instructions. Callback URL computed from `process.env.APP_URL`.
- `$ssoConfigId/index.tsx` — detail page with: header badges, KPI strip, Configuration card (masks `clientId`/`clientSecret`), Test Connection card with fetcher-posted intent button, IdP instructions panel.
- `$ssoConfigId/edit.tsx` — same form as `new.tsx` but prefilled. `clientSecret` left blank preserves existing.
- `$ssoConfigId/delete.tsx` — destructive-confirm page.

## Env

`~/utils/config/env.server.ts` gains `APP_URL` (default `http://localhost:5173`). The service uses it to build callback URLs (`${APP_URL}/sso/callback`) and default SP entity IDs.

## i18n

New namespace `sso` (~55 keys, en + fr), registered in `~/utils/i18n.ts`. `settings.json` gets a `navSso` entry (en + fr). Login-page SSO button copy isn't shipped.

## Permissions

Added to `UNIQUE_PERMISSIONS` under module `auth`: `sso:{read,write,delete}`. Admin role picks them up automatically on seed.

## Deviations

- **No feature flag.** The natural gate is "does this tenant have an active config". If a fork wants a full kill-switch, wrap the three read/write/delete actions in `requireFeature`.
- **Login page shows no "Sign in with SSO" button by default.** Apps that want a button on their login page should query `getSSOConfigurations(tenant.id)` in the login loader and render buttons per active config.
- **`resolveOrProvisionUser` splits the IdP `name` claim** (`"Jane Doe"` → `firstName: "Jane", lastName: "Doe"`). Falls back to `firstName = email-local-part, lastName = ""` if the IdP sends no name.
- **No `photoUrl` on the template's User model** — the IdP `picture` claim is written to `SSOConnection.avatarUrl` but not copied to the User.
- **User activation is tracked via `userStatusId → UserStatus.code`.**
- **`unlinkSSOAccount` + `getUserSSOConnections` are shipped but not wired** to any profile/settings UI yet.
- **No custom-role check on `defaultRoleId`** beyond excluding `admin` from the dropdown.
- **`env.APP_URL` defaults to `http://localhost:5173`.** Production deploys MUST set it.
- **No migration file.** Schema applied via `db push`.
