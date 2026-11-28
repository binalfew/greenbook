# SSO (Phase 10)

Phase 10 adds enterprise SSO — both OpenID Connect (OIDC) and SAML 2.0 — with an admin UI and the authentication flow wired end-to-end.

SSO is **platform-wide**: identity providers are configured once for the whole platform, not per tenant. `SSOConfiguration` and `SSOConnection` have no `tenantId`; a user's tenant is the one on their user record.

## Packages

- `openid-client@^6` — OIDC discovery + PKCE + token exchange.
- `samlify@^2` — SAML 2.0 AuthnRequest generation + Response validation + attribute extraction.

## Schema

Two models + two enums in `prisma/schema.prisma`:

- `SSOProvider` enum — `OKTA` / `AZURE_AD` / `GOOGLE` / `CUSTOM_OIDC` / `CUSTOM_SAML`.
- `SSOProtocol` enum — `OIDC` / `SAML`.
- `SSOConfiguration` — one row per IdP. Stores OIDC fields (`clientId`, `clientSecret`, `issuerUrl`, `metadataUrl`), SAML fields (`ssoUrl`, `x509Certificate`, `spEntityId`, `nameIdFormat`), plus `callbackUrl`, `autoProvision`, `enforceSSO`, `defaultRoleId`, `isActive`.
- `SSOConnection` — one row per (user, provider). Tracks the IdP's `providerUserId` + last login.

Back-relation: `User.ssoConnections`. Applied via `db push` (no migration file).

## Utilities

- `~/utils/auth/oidc.server.ts` — openid-client v6 wrapper. Exports `discoverOIDCProvider` (cached 10 min), PKCE helpers (`generateCodeVerifier`, `generateCodeChallenge`), `generateState`, `generateNonce`, `buildAuthorizationUrl`, `exchangeCodeForClaims`, and a dry-run `testOIDCDiscovery` for the "Test Connection" button.
- `~/utils/auth/saml.server.ts` — samlify wrapper. Exports `buildSAMLRedirectUrl`, `validateSAMLResponse`, `generateRequestId`, `generateSAMLState`, `testSAMLConfiguration`. `samlify.setSchemaValidator` is set to permissive (signature validation still runs internally via xml-crypto).
- `~/utils/auth/sso-state.server.ts` — short-lived (10-min) cookie session storage (`__sso_state`) plus HMAC-signed SAML RelayState encoding. The SAML path encodes flow state into `RelayState` instead of cookies because SAML IdPs POST back cross-origin and `sameSite=lax` cookies don't traverse that.
- `~/utils/schemas/sso.ts` — `createSSOConfigSchema` Zod validator covering both protocols' fields (all optional-per-protocol, service enforces required subset).
- `~/utils/constants/sso.ts` — `SSO_PROVIDER_OPTIONS`, `SSO_PROTOCOL_OPTIONS`, `IDP_INSTRUCTIONS` (setup guides per provider, including Okta-SAML + Azure-AD-SAML variants).

## Service

`~/services/sso.server.ts`:

- **CRUD:** `getSSOConfigurations()`, `getActiveSSOConfigurations()`, `getSSOConfigById`, `createSSOConfiguration`, `updateSSOConfiguration` (preserves `clientSecret` when not provided), `deleteSSOConfiguration`, `getSSOConnectionCount*`.
- **Switches:** `isActive` and `enforceSSO` are both set from the provider form. An inactive provider is not offered on the login page, cannot start or finish a flow, and enforces nothing. `isSSOEnforced()` is true when an active provider has `enforceSSO`: `/login` then hides the password form (the loader returns `ssoEnforced`) and its action refuses password sign-in to everyone but the global admin, with one message for a wrong password and a non-admin alike. The admin keeps password sign-in (the "Administrator sign-in" link, `/login?password=1`) so a broken identity provider cannot lock the platform out — do not remove that exception.
- **Test:** `testSSOConfiguration(id)` — dispatches to `testOIDCDiscovery` or `testSAMLConfiguration` based on protocol. Returns `{ success, error? }`.
- **Flow initiation:** `initiateSSOFlow(configId)` — builds authorization URL + captures state/nonce/PKCE/requestId; caller persists flow state via cookie (OIDC) or RelayState (SAML).
- **Callback:** `handleSSOCallback({ protocol, ...params })` — dispatches to `handleOIDCCallback` (exchanges code for claims, calls `resolveOrProvisionUser`) or `handleSAMLCallback` (validates SAML Response, extracts `nameId`/email/name).
- **Linking:** `linkSSOAccount` / `linkSAMLAccount` — adds an `SSOConnection` row for an already-authenticated user without creating a new session. `getUserSSOConnections` / `unlinkSSOAccount` back the linked-accounts section of the profile page (`$tenant/profile/index.tsx`).
- **User resolution (`resolveOrProvisionUser`):** (1) existing `SSOConnection` → update last-login, check `userStatus.code === "ACTIVE"`; (2) existing user by case-insensitive email → create connection; (3) auto-provision iff `autoProvision` is true — creates a user that belongs to no tenant yet (an admin assigns one afterwards) with `userStatusId` → ACTIVE, splits the IdP `name` claim into `firstName`/`lastName`, optionally assigns `defaultRoleId`. All inside a `$transaction`.

## Routes

**Authentication flow** (under `_auth/` → URL-visible at `/sso/*`, no tenant prefix):

- `/sso/start?configId=<id>[&redirectTo=<path>][&link=true]` — loader-only redirect. Link mode requires a signed-in user. Looks up the SSO config, mints PKCE/state, stores flow state (cookie for OIDC, signed RelayState for SAML), redirects to the IdP.
- `/sso/callback` — GET loader handles OIDC; POST action handles SAML (cross-origin POST from the IdP). Validates state/nonce, exchanges code (OIDC) or validates Response (SAML), writes a `LOGIN` audit entry via `writeAudit`, deletes any existing user sessions (single-session model), creates a new `Session` row, sets the `sessionKey` cookie, redirects to `flowState.redirectTo || "/"`. Renders a standalone "Sign-in Failed" page when the callback rejects.

**Admin** (under `$tenant/settings/security/sso/`, gated on the `sso:*` permissions, which only the `admin` role holds):

- `index.tsx` — DataTable with provider/protocol/status columns, search across displayName/provider/issuerUrl, filters for protocol + active/inactive, connection-count per provider (via `groupBy`).
- `new.tsx` — full form with OIDC Configuration + SAML Configuration + Provisioning cards; setup-guide accordion shows per-provider IdP instructions. Callback URL computed from `process.env.APP_URL`.
- `$ssoConfigId/index.tsx` — detail page with: header badges, KPI strip, Configuration card (masks `clientId`/`clientSecret`), Test Connection card with fetcher-posted intent button, IdP instructions panel.
- `$ssoConfigId/edit.tsx` — same form as `new.tsx` but prefilled. `clientSecret` left blank preserves existing.
- `$ssoConfigId/delete.tsx` — destructive-confirm page.

## Env

`~/utils/config/env.server.ts` gains `APP_URL` (default `http://localhost:5173`). The service uses it to build callback URLs (`${APP_URL}/sso/callback`) and default SP entity IDs.

## i18n

New namespace `sso` (~55 keys, en + fr), registered in `~/utils/i18n.ts`. `settings.json` gets a `navSso` entry (en + fr).

## Permissions

Added to `UNIQUE_PERMISSIONS` under module `auth`: `sso:{read,write,delete}`. Admin role picks them up automatically on seed.

## Deviations

- **No feature flag.** The gate is "is there an active configuration": the login page lists a button per active config (`getActiveSSOConfigurations()` in `app/routes/_auth/login.tsx`).
- **Auto-provisioned users have no tenant.** The IdP carries no tenant signal, so an admin has to place the user before they can use a workspace.
- **`resolveOrProvisionUser` splits the IdP `name` claim** (`"Jane Doe"` → `firstName: "Jane", lastName: "Doe"`). Falls back to `firstName = email-local-part, lastName = ""` if the IdP sends no name.
- **No photo on the `User` model** — the IdP `picture` claim is written to `SSOConnection.avatarUrl` but not copied to the User.
- **User activation is tracked via `userStatusId → UserStatus.code`.**
- **No custom-role check on `defaultRoleId`** beyond excluding `admin` from the dropdown.
- **`env.APP_URL` defaults to `http://localhost:5173`.** Production deploys MUST set it.
- **No migration file.** Schema applied via `db push`.
