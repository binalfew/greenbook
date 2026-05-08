import type { SSOProvider } from "~/generated/prisma/client.js";
import {
  buildAuthorizationUrl,
  discoverOIDCProvider,
  exchangeCodeForClaims,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
  testOIDCDiscovery,
  type OIDCUserClaims,
} from "~/utils/auth/oidc.server";
import {
  buildSAMLRedirectUrl as samlBuildRedirectUrl,
  generateRequestId as samlGenerateRequestId,
  generateSAMLState as samlGenerateState,
  testSAMLConfiguration as samlTestConfig,
  validateSAMLResponse as samlValidateResponse,
  type SAMLProviderConfig,
} from "~/utils/auth/saml.server";
import { prisma } from "~/utils/db/db.server";
import type { CreateSSOConfigInput } from "~/utils/schemas/sso";
import { logger } from "~/utils/monitoring/logger.server";

/**
 * Audit-only context for SSO admin operations. Under global SSO, configs are
 * not tenant-scoped, so we no longer carry a `tenantId` here. The userId is
 * retained for log lines.
 */
export interface SSOAdminContext {
  userId: string;
}

export class SSOError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SSOError";
    this.status = status;
  }
}

function buildSAMLConfig(config: {
  issuerUrl: string | null;
  x509Certificate: string | null;
  ssoUrl: string | null;
  callbackUrl: string;
  spEntityId: string | null;
  nameIdFormat: string | null;
}): SAMLProviderConfig {
  if (!config.issuerUrl || !config.x509Certificate || !config.ssoUrl) {
    throw new SSOError(
      "SAML configuration is incomplete (missing entity ID, certificate, or SSO URL)",
      400,
    );
  }
  if (!config.callbackUrl) {
    throw new SSOError(
      "SAML configuration is missing a callback URL — re-save the configuration in settings.",
      400,
    );
  }
  return {
    issuerUrl: config.issuerUrl,
    x509Certificate: config.x509Certificate,
    ssoUrl: config.ssoUrl,
    callbackUrl: config.callbackUrl,
    // SAML SP entity ID falls back to the callback URL's origin when the
    // admin didn't set one explicitly. Same hostname source — no env reads.
    spEntityId: config.spEntityId || new URL(config.callbackUrl).origin,
    nameIdFormat: config.nameIdFormat || undefined,
  };
}

// ─── CRUD ─────────────────────────────────────────────────

export async function getSSOConfigurations() {
  return prisma.sSOConfiguration.findMany({
    orderBy: { createdAt: "asc" },
  });
}

export async function getActiveSSOConfigurations() {
  return prisma.sSOConfiguration.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, displayName: true, protocol: true },
  });
}

export async function getSSOConfigById(id: string) {
  return prisma.sSOConfiguration.findUnique({ where: { id } });
}

export async function createSSOConfiguration(input: CreateSSOConfigInput, ctx: SSOAdminContext) {
  logger.info(`Creating SSO configuration [${input.provider}] [actor=${ctx.userId}]`);

  return prisma.sSOConfiguration.create({
    data: {
      provider: input.provider,
      protocol: input.protocol,
      displayName: input.displayName || undefined,
      issuerUrl: input.issuerUrl || undefined,
      clientId: input.clientId || undefined,
      clientSecret: input.clientSecret || undefined,
      metadataUrl: input.metadataUrl || undefined,
      callbackUrl: input.callbackUrl,
      autoProvision: input.autoProvision === "on",
      enforceSSO: input.enforceSSO === "on",
      defaultRoleId: input.defaultRoleId || undefined,
      x509Certificate: input.x509Certificate || undefined,
      ssoUrl: input.ssoUrl || undefined,
      spEntityId: input.spEntityId || undefined,
      nameIdFormat: input.nameIdFormat || undefined,
    },
  });
}

export async function updateSSOConfiguration(
  id: string,
  input: CreateSSOConfigInput,
  ctx: SSOAdminContext,
) {
  const existing = await prisma.sSOConfiguration.findUnique({ where: { id } });

  if (!existing) {
    throw new SSOError("SSO configuration not found", 404);
  }

  logger.info(`Updating SSO configuration ${id} [${input.provider}] [actor=${ctx.userId}]`);

  return prisma.sSOConfiguration.update({
    where: { id },
    data: {
      provider: input.provider,
      protocol: input.protocol,
      displayName: input.displayName || null,
      issuerUrl: input.issuerUrl || null,
      clientId: input.clientId || null,
      // Keep existing secret if not provided
      ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
      metadataUrl: input.metadataUrl || null,
      callbackUrl: input.callbackUrl,
      autoProvision: input.autoProvision === "on",
      enforceSSO: input.enforceSSO === "on",
      defaultRoleId: input.defaultRoleId || null,
      ...(input.x509Certificate ? { x509Certificate: input.x509Certificate } : {}),
      ssoUrl: input.ssoUrl || null,
      spEntityId: input.spEntityId || null,
      nameIdFormat: input.nameIdFormat || null,
    },
  });
}

export async function deleteSSOConfiguration(id: string, ctx: SSOAdminContext) {
  const existing = await prisma.sSOConfiguration.findUnique({ where: { id } });

  if (!existing) {
    throw new SSOError("SSO configuration not found", 404);
  }

  logger.info(`Deleting SSO configuration ${id} [user=${ctx.userId}]`);
  return prisma.sSOConfiguration.delete({ where: { id } });
}

export async function getSSOConnectionCount(): Promise<number> {
  return prisma.sSOConnection.count();
}

export async function getSSOConnectionCountByConfig(provider: SSOProvider): Promise<number> {
  return prisma.sSOConnection.count({ where: { provider } });
}

// ─── Test Connection ──────────────────────────────────────

export async function testSSOConfiguration(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const config = await prisma.sSOConfiguration.findUnique({ where: { id } });

  if (!config) {
    return { success: false, error: "No SSO configuration found" };
  }

  if (config.protocol === "SAML") {
    if (!config.issuerUrl || !config.x509Certificate || !config.ssoUrl) {
      return {
        success: false,
        error: "IdP Entity ID, X.509 certificate, and SSO URL are required for SAML test",
      };
    }
    return samlTestConfig(buildSAMLConfig(config));
  }

  if (!config.issuerUrl && !config.metadataUrl) {
    return { success: false, error: "Issuer URL or Metadata URL is required for connection test" };
  }

  if (!config.clientId || !config.clientSecret) {
    return {
      success: false,
      error: "Client ID and Client Secret are required for connection test",
    };
  }

  return testOIDCDiscovery({
    issuerUrl: config.issuerUrl ?? "",
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
}

// ─── SSO Flow ─────────────────────────────────────────────

export interface SSOFlowResult {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  ssoConfigId: string;
  protocol: "OIDC" | "SAML";
  requestId?: string;
}

export async function initiateSSOFlow(configId: string): Promise<SSOFlowResult> {
  const config = await prisma.sSOConfiguration.findUnique({ where: { id: configId } });
  if (!config || !config.isActive) {
    throw new SSOError("SSO configuration not found or inactive", 404);
  }

  // Use the callback URL stored on the SSO configuration row — this is what
  // the admin entered (and is what's registered with the IdP). Falling back
  // to APP_URL would be misleading when the env hostname drifts from the
  // public-facing URL the IdP knows about.
  const callbackUrl = config.callbackUrl;
  if (!callbackUrl) {
    throw new SSOError(
      "SSO configuration is missing a callback URL — re-save the configuration in settings.",
      400,
    );
  }

  if (config.protocol === "SAML") {
    return initiateSAMLFlow(config, configId, callbackUrl);
  }

  return initiateOIDCFlow(config, configId, callbackUrl);
}

async function initiateOIDCFlow(
  config: NonNullable<Awaited<ReturnType<typeof prisma.sSOConfiguration.findUnique>>>,
  configId: string,
  callbackUrl: string,
): Promise<SSOFlowResult> {
  if (!config.clientId || !config.clientSecret || !config.issuerUrl) {
    throw new SSOError(
      "OIDC configuration is incomplete (missing client ID, secret, or issuer URL)",
      400,
    );
  }

  const oidcConfig = await discoverOIDCProvider({
    issuerUrl: config.issuerUrl,
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();
  const nonce = generateNonce();

  const authorizationUrl = buildAuthorizationUrl({
    config: oidcConfig,
    redirectUri: callbackUrl,
    state,
    nonce,
    codeChallenge,
  });

  logger.info(`SSO flow initiated [provider=${config.provider} protocol=OIDC]`);

  return {
    authorizationUrl,
    state,
    nonce,
    codeVerifier,
    ssoConfigId: configId,
    protocol: "OIDC",
  };
}

async function initiateSAMLFlow(
  config: NonNullable<Awaited<ReturnType<typeof prisma.sSOConfiguration.findUnique>>>,
  configId: string,
  _callbackUrl: string,
): Promise<SSOFlowResult> {
  if (!config.issuerUrl || !config.x509Certificate || !config.ssoUrl) {
    throw new SSOError(
      "SAML configuration is incomplete (missing entity ID, certificate, or SSO URL)",
      400,
    );
  }

  const requestId = samlGenerateRequestId();
  const state = samlGenerateState();

  const authorizationUrl = await samlBuildRedirectUrl(buildSAMLConfig(config), requestId, state);

  logger.info(`SSO flow initiated [provider=${config.provider} protocol=SAML]`);

  return {
    authorizationUrl,
    state,
    nonce: "",
    codeVerifier: "",
    ssoConfigId: configId,
    protocol: "SAML",
    requestId,
  };
}

export interface SSOCallbackResult {
  userId: string;
  /** The user's tenant slug, or `null` for global / tenantless users. */
  tenantSlug: string | null;
}

export async function handleSSOCallback(params: {
  protocol: "OIDC" | "SAML";
  // OIDC params
  code?: string;
  callbackUrl?: URL;
  codeVerifier?: string;
  nonce?: string;
  state?: string;
  // SAML params
  samlResponse?: string;
  requestId?: string;
  // Common
  ssoConfigId: string;
}): Promise<SSOCallbackResult> {
  if (params.protocol === "SAML") {
    return handleSAMLCallback(
      params as {
        protocol: "SAML";
        samlResponse: string;
        requestId: string;
        ssoConfigId: string;
      },
    );
  }
  return handleOIDCCallback(
    params as {
      protocol: "OIDC";
      code: string;
      callbackUrl: URL;
      codeVerifier: string;
      nonce: string;
      state: string;
      ssoConfigId: string;
    },
  );
}

/**
 * After provisioning/resolving a user, look up their tenant slug. Returns
 * `null` for users with no tenant (e.g. global admins).
 */
async function resolveTenantSlug(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenant: { select: { slug: true } } },
  });
  return user?.tenant?.slug ?? null;
}

async function handleOIDCCallback(params: {
  code: string;
  callbackUrl: URL;
  codeVerifier: string;
  nonce: string;
  state: string;
  ssoConfigId: string;
}): Promise<SSOCallbackResult> {
  const config = await prisma.sSOConfiguration.findUnique({
    where: { id: params.ssoConfigId },
  });

  if (
    !config ||
    !config.isActive ||
    !config.clientId ||
    !config.clientSecret ||
    !config.issuerUrl ||
    !config.callbackUrl
  ) {
    throw new SSOError("SSO configuration is missing or inactive", 400);
  }

  const oidcConfig = await discoverOIDCProvider({
    issuerUrl: config.issuerUrl,
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  // Build the URL that openid-client uses to derive `redirect_uri` for the
  // token exchange. It MUST match what we sent at /authorize (i.e., the
  // DB-stored callbackUrl) — proxies and X-Forwarded-* drift can make
  // `request.url` differ from the public URL the IdP knows about. We start
  // from `config.callbackUrl` and copy across the IdP's query params so
  // openid-client can still extract `code` and `state`.
  const exchangeUrl = new URL(config.callbackUrl);
  for (const [key, value] of params.callbackUrl.searchParams) {
    exchangeUrl.searchParams.set(key, value);
  }

  const claims = await exchangeCodeForClaims({
    config: oidcConfig,
    callbackUrl: exchangeUrl,
    codeVerifier: params.codeVerifier,
    expectedNonce: params.nonce,
    expectedState: params.state,
  });

  const userId = await resolveOrProvisionUser({
    claims,
    provider: config.provider,
    autoProvision: config.autoProvision,
    defaultRoleId: config.defaultRoleId,
  });

  const tenantSlug = await resolveTenantSlug(userId);
  logger.info(`SSO OIDC callback successful [user=${userId} provider=${config.provider}]`);
  return { userId, tenantSlug };
}

async function handleSAMLCallback(params: {
  samlResponse: string;
  requestId: string;
  ssoConfigId: string;
}): Promise<SSOCallbackResult> {
  const config = await prisma.sSOConfiguration.findUnique({
    where: { id: params.ssoConfigId },
  });

  if (
    !config ||
    !config.isActive ||
    !config.issuerUrl ||
    !config.x509Certificate ||
    !config.ssoUrl
  ) {
    throw new SSOError("SAML configuration is missing or inactive", 400);
  }

  const samlConfig = buildSAMLConfig(config);
  const claims = await samlValidateResponse(samlConfig, params.samlResponse, params.requestId);

  const userId = await resolveOrProvisionUser({
    claims: {
      sub: claims.nameId,
      email: claims.email,
      name: claims.name,
    },
    provider: config.provider,
    autoProvision: config.autoProvision,
    defaultRoleId: config.defaultRoleId,
  });

  const tenantSlug = await resolveTenantSlug(userId);
  logger.info(`SSO SAML callback successful [user=${userId} provider=${config.provider}]`);
  return { userId, tenantSlug };
}

// ─── Account Linking ──────────────────────────────────────

export async function linkSSOAccount(params: {
  code: string;
  callbackUrl: URL;
  codeVerifier: string;
  nonce: string;
  state: string;
  ssoConfigId: string;
  userId: string;
}): Promise<void> {
  const config = await prisma.sSOConfiguration.findUnique({
    where: { id: params.ssoConfigId },
  });

  if (
    !config ||
    !config.isActive ||
    !config.clientId ||
    !config.clientSecret ||
    !config.issuerUrl ||
    !config.callbackUrl
  ) {
    throw new SSOError("SSO configuration is missing or inactive", 400);
  }

  const oidcConfig = await discoverOIDCProvider({
    issuerUrl: config.issuerUrl,
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  // See handleOIDCCallback — `redirect_uri` at token exchange must match
  // what was sent at /authorize. Use the DB-stored callbackUrl, not the
  // request URL (which may differ behind a proxy).
  const exchangeUrl = new URL(config.callbackUrl);
  for (const [key, value] of params.callbackUrl.searchParams) {
    exchangeUrl.searchParams.set(key, value);
  }

  const claims = await exchangeCodeForClaims({
    config: oidcConfig,
    callbackUrl: exchangeUrl,
    codeVerifier: params.codeVerifier,
    expectedNonce: params.nonce,
    expectedState: params.state,
  });

  const existingConnection = await prisma.sSOConnection.findUnique({
    where: { provider_providerUserId: { provider: config.provider, providerUserId: claims.sub } },
  });

  if (existingConnection) {
    if (existingConnection.userId === params.userId) {
      throw new SSOError("This account is already connected.", 409);
    }
    throw new SSOError("This identity is already linked to a different account.", 409);
  }

  await prisma.sSOConnection.create({
    data: {
      userId: params.userId,
      provider: config.provider,
      providerUserId: claims.sub,
      email: claims.email,
      displayName: claims.name,
      avatarUrl: claims.picture,
    },
  });

  logger.info(`SSO OIDC account linked [user=${params.userId} provider=${config.provider}]`);
}

export async function linkSAMLAccount(params: {
  samlResponse: string;
  requestId: string;
  ssoConfigId: string;
  userId: string;
}): Promise<void> {
  const config = await prisma.sSOConfiguration.findUnique({
    where: { id: params.ssoConfigId },
  });

  if (
    !config ||
    !config.isActive ||
    !config.issuerUrl ||
    !config.x509Certificate ||
    !config.ssoUrl
  ) {
    throw new SSOError("SAML configuration is missing or inactive", 400);
  }

  const samlConfig = buildSAMLConfig(config);
  const claims = await samlValidateResponse(samlConfig, params.samlResponse, params.requestId);

  const existingConnection = await prisma.sSOConnection.findUnique({
    where: {
      provider_providerUserId: { provider: config.provider, providerUserId: claims.nameId },
    },
  });

  if (existingConnection) {
    if (existingConnection.userId === params.userId) {
      throw new SSOError("This account is already connected.", 409);
    }
    throw new SSOError("This identity is already linked to a different account.", 409);
  }

  await prisma.sSOConnection.create({
    data: {
      userId: params.userId,
      provider: config.provider,
      providerUserId: claims.nameId,
      email: claims.email,
      displayName: claims.name,
    },
  });

  logger.info(`SSO SAML account linked [user=${params.userId} provider=${config.provider}]`);
}

export async function unlinkSSOAccount(connectionId: string, userId: string): Promise<void> {
  const connection = await prisma.sSOConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    throw new SSOError("SSO connection not found", 404);
  }

  if (connection.userId !== userId) {
    throw new SSOError("Not authorized to unlink this connection", 403);
  }

  await prisma.sSOConnection.delete({ where: { id: connectionId } });
  logger.info(`SSO account unlinked [user=${userId} connection=${connectionId}]`);
}

export async function getUserSSOConnections(userId: string) {
  return prisma.sSOConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

// ─── User Resolution ──────────────────────────────────────

function splitName(fullName?: string | null): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

async function resolveOrProvisionUser(params: {
  claims: OIDCUserClaims;
  provider: SSOProvider;
  autoProvision: boolean;
  defaultRoleId: string | null;
}): Promise<string> {
  const { claims, provider, autoProvision, defaultRoleId } = params;

  // 1. Existing SSOConnection — sign in directly. No tenant matching needed
  //    under global SSO; the user's tenant comes from `user.tenantId`.
  const existingConnection = await prisma.sSOConnection.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: claims.sub } },
    include: {
      user: {
        select: { id: true, userStatus: { select: { code: true } } },
      },
    },
  });

  if (existingConnection) {
    if (existingConnection.user.userStatus?.code !== "ACTIVE") {
      throw new SSOError("Your account is inactive. Contact your administrator.", 403);
    }

    await prisma.sSOConnection.update({
      where: { id: existingConnection.id },
      data: {
        lastLoginAt: new Date(),
        email: claims.email,
        displayName: claims.name ?? existingConnection.displayName,
        avatarUrl: claims.picture ?? existingConnection.avatarUrl,
      },
    });

    return existingConnection.userId;
  }

  // 2. Existing user by email (case-insensitive) — link the connection.
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: claims.email, mode: "insensitive" } },
    select: {
      id: true,
      userStatus: { select: { code: true } },
    },
  });

  if (existingUser) {
    if (existingUser.userStatus?.code !== "ACTIVE") {
      throw new SSOError("Your account is inactive. Contact your administrator.", 403);
    }

    await prisma.sSOConnection.create({
      data: {
        userId: existingUser.id,
        provider,
        providerUserId: claims.sub,
        email: claims.email,
        displayName: claims.name,
        avatarUrl: claims.picture,
      },
    });

    logger.info(`SSO connection linked to existing user ${existingUser.id}`);
    return existingUser.id;
  }

  // 3. Auto-provision new user. Under global SSO we have no platform-side
  //    tenant signal; the user is created tenantless and an admin must assign
  //    them later (or the IdP can carry tenant info via claims — future work).
  if (!autoProvision) {
    throw new SSOError(
      "No account found for this email. Contact your administrator to create an account.",
      403,
    );
  }

  const activeStatus = await prisma.userStatus.findUnique({
    where: { code: "ACTIVE" },
    select: { id: true },
  });

  const { firstName, lastName } = splitName(claims.name);

  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: claims.email.toLowerCase(),
        firstName: firstName || claims.email.split("@")[0],
        lastName,
        userStatusId: activeStatus?.id,
      },
    });

    await tx.sSOConnection.create({
      data: {
        userId: newUser.id,
        provider,
        providerUserId: claims.sub,
        email: claims.email,
        displayName: claims.name,
        avatarUrl: claims.picture,
      },
    });

    if (defaultRoleId) {
      await tx.userRole.create({
        data: {
          userId: newUser.id,
          roleId: defaultRoleId,
        },
      });
    }

    return newUser;
  });

  logger.info(`SSO user auto-provisioned [user=${result.id} provider=${provider}]`);
  return result.id;
}
