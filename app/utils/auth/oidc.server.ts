import * as client from "openid-client";

// ─── OIDC Client Wrapper ─────────────────────────────────
// Isolates all openid-client v6 interactions into a single file.
// Handles: discovery, PKCE, authorization URL, token exchange.

export interface OIDCProviderConfig {
  issuerUrl: string;
  metadataUrl?: string | null;
  clientId: string;
  clientSecret: string;
}

export interface OIDCAuthParams {
  config: client.Configuration;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  scopes?: string[];
}

export interface OIDCTokenExchangeParams {
  config: client.Configuration;
  callbackUrl: URL;
  codeVerifier: string;
  expectedNonce: string;
  expectedState: string;
}

export interface OIDCUserClaims {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

// ─── Discovery (cached) ──────────────────────────────────

const discoveryCache = new Map<string, { config: client.Configuration; expiresAt: number }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function discoverOIDCProvider(
  providerConfig: OIDCProviderConfig,
): Promise<client.Configuration> {
  const cacheKey = `${providerConfig.issuerUrl}|${providerConfig.clientId}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const issuerUrl = providerConfig.metadataUrl
    ? new URL(providerConfig.metadataUrl.replace("/.well-known/openid-configuration", ""))
    : new URL(providerConfig.issuerUrl);

  const config = await client.discovery(
    issuerUrl,
    providerConfig.clientId,
    providerConfig.clientSecret,
  );
  discoveryCache.set(cacheKey, { config, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return config;
}

// ─── PKCE ────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return client.randomPKCECodeVerifier();
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  return client.calculatePKCECodeChallenge(codeVerifier);
}

// ─── State & Nonce ───────────────────────────────────────

export function generateState(): string {
  return client.randomState();
}

export function generateNonce(): string {
  return client.randomNonce();
}

// ─── Authorization URL ───────────────────────────────────

export function buildAuthorizationUrl(params: OIDCAuthParams): string {
  const parameters: Record<string, string> = {
    redirect_uri: params.redirectUri,
    scope: (params.scopes ?? ["openid", "email", "profile"]).join(" "),
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    nonce: params.nonce,
    response_type: "code",
  };

  const url = client.buildAuthorizationUrl(params.config, parameters);
  return url.href;
}

// ─── Token Exchange ──────────────────────────────────────

export async function exchangeCodeForClaims(
  params: OIDCTokenExchangeParams,
): Promise<OIDCUserClaims> {
  const tokens = await client.authorizationCodeGrant(params.config, params.callbackUrl, {
    pkceCodeVerifier: params.codeVerifier,
    expectedNonce: params.expectedNonce,
    expectedState: params.expectedState,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims) {
    throw new Error("No ID token claims received from provider");
  }

  const email = claims.email as string | undefined;
  if (!email) {
    throw new Error("Provider did not return an email claim. Ensure 'email' scope is requested.");
  }

  return {
    sub: claims.sub,
    email,
    emailVerified: claims.email_verified as boolean | undefined,
    name: claims.name as string | undefined,
    picture: claims.picture as string | undefined,
  };
}

// ─── Test Connection ─────────────────────────────────────

export async function testOIDCDiscovery(
  providerConfig: OIDCProviderConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await discoverOIDCProvider(providerConfig);
    const metadata = config.serverMetadata();

    if (!metadata.authorization_endpoint) {
      return { success: false, error: "Provider metadata missing authorization_endpoint" };
    }
    if (!metadata.token_endpoint) {
      return { success: false, error: "Provider metadata missing token_endpoint" };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: `Failed to discover provider: ${message}` };
  }
}
