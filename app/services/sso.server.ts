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
import type { TenantServiceContext } from "~/utils/types.server";
import { logger } from "~/utils/monitoring/logger.server";

export class SSOError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SSOError";
    this.status = status;
  }
}

function getAppUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

function buildSAMLConfig(config: {
  issuerUrl: string | null;
  x509Certificate: string | null;
  ssoUrl: string | null;
  spEntityId: string | null;
  nameIdFormat: string | null;
}): SAMLProviderConfig {
  if (!config.issuerUrl || !config.x509Certificate || !config.ssoUrl) {
    throw new SSOError(
      "SAML configuration is incomplete (missing entity ID, certificate, or SSO URL)",
      400,
    );
  }
  const appUrl = getAppUrl();
  return {
    issuerUrl: config.issuerUrl,
    x509Certificate: config.x509Certificate,
    ssoUrl: config.ssoUrl,
    callbackUrl: `${appUrl}/sso/callback`,
    spEntityId: config.spEntityId || appUrl,
    nameIdFormat: config.nameIdFormat || undefined,
  };
}

// ─── CRUD ─────────────────────────────────────────────────

export async function getSSOConfigurations(tenantId: string) {
  return prisma.sSOConfiguration.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getSSOConfigById(id: string) {
  return prisma.sSOConfiguration.findUnique({ where: { id } });
}

export async function createSSOConfiguration(
  input: CreateSSOConfigInput,
  ctx: TenantServiceContext,
) {
  logger.info(`Creating SSO configuration [${input.provider}] for tenant ${ctx.tenantId}`);

  return prisma.sSOConfiguration.create({
    data: {
      tenantId: ctx.tenantId,
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
  _ctx: TenantServiceContext,
) {
  const existing = await prisma.sSOConfiguration.findUnique({ where: { id } });

  if (!existing) {
    throw new SSOError("SSO configuration not found", 404);
  }

  logger.info(`Updating SSO configuration ${id} [${input.provider}]`);

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

export async function deleteSSOConfiguration(id: string, ctx: TenantServiceContext) {
  const existing = await prisma.sSOConfiguration.findUnique({ where: { id } });

  if (!existing) {
    throw new SSOError("SSO configuration not found", 404);
  }

  logger.info(`Deleting SSO configuration ${id} [user=${ctx.userId}]`);
  return prisma.sSOConfiguration.delete({ where: { id } });
}

export async function getSSOConnectionCount(tenantId: string): Promise<number> {
  return prisma.sSOConnection.count({ where: { tenantId } });
}

export async function getSSOConnectionCountByConfig(
  provider: SSOProvider,
  tenantId: string,
): Promise<number> {
  return prisma.sSOConnection.count({ where: { provider, tenantId } });
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
  tenantId: string;
  tenantSlug: string;
  ssoConfigId: string;
  protocol: "OIDC" | "SAML";
  requestId?: string;
}

export async function initiateSSOFlow(
  configId: string,
  tenantSlug: string,
  _redirectTo: string,
): Promise<SSOFlowResult> {
  const config = await prisma.sSOConfiguration.findUnique({ where: { id: configId } });
  if (!config || !config.isActive) {
    throw new SSOError("SSO configuration not found or inactive", 404);
  }

  const callbackUrl = `${getAppUrl()}/sso/callback`;

  if (config.protocol === "SAML") {
    return initiateSAMLFlow(config, configId, tenantSlug, callbackUrl);
  }

  return initiateOIDCFlow(config, configId, tenantSlug, callbackUrl);
}

async function initiateOIDCFlow(
  config: NonNullable<Awaited<ReturnType<typeof prisma.sSOConfiguration.findUnique>>>,
  configId: string,
  tenantSlug: string,
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

  logger.info(
    `SSO flow initiated [tenant=${tenantSlug} provider=${config.provider} protocol=OIDC]`,
  );

  return {
    authorizationUrl,
    state,
    nonce,
    codeVerifier,
    tenantId: config.tenantId,
    tenantSlug,
    ssoConfigId: configId,
    protocol: "OIDC",
  };
}

async function initiateSAMLFlow(
  config: NonNullable<Awaited<ReturnType<typeof prisma.sSOConfiguration.findUnique>>>,
  configId: string,
  tenantSlug: string,
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

  logger.info(
    `SSO flow initiated [tenant=${tenantSlug} provider=${config.provider} protocol=SAML]`,
  );

  return {
    authorizationUrl,
    state,
    nonce: "",
    codeVerifier: "",
    tenantId: config.tenantId,
    tenantSlug,
    ssoConfigId: configId,
    protocol: "SAML",
    requestId,
  };
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
}): Promise<{ userId: string; tenantId: string }> {
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

async function handleOIDCCallback(params: {
  code: string;
  callbackUrl: URL;
  codeVerifier: string;
  nonce: string;
  state: string;
  ssoConfigId: string;
}): Promise<{ userId: string; tenantId: string }> {
  const config = await prisma.sSOConfiguration.findUnique({
    where: { id: params.ssoConfigId },
  });

  if (
    !config ||
    !config.isActive ||
    !config.clientId ||
    !config.clientSecret ||
    !config.issuerUrl
  ) {
    throw new SSOError("SSO configuration is missing or inactive", 400);
  }

  const oidcConfig = await discoverOIDCProvider({
    issuerUrl: config.issuerUrl,
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const claims = await exchangeCodeForClaims({
    config: oidcConfig,
    callbackUrl: params.callbackUrl,
    codeVerifier: params.codeVerifier,
    expectedNonce: params.nonce,
    expectedState: params.state,
  });

  const userId = await resolveOrProvisionUser({
    claims,
    tenantId: config.tenantId,
    provider: config.provider,
    autoProvision: config.autoProvision,
    defaultRoleId: config.defaultRoleId,
  });

  logger.info(`SSO OIDC callback successful [user=${userId} provider=${config.provider}]`);
  return { userId, tenantId: config.tenantId };
}

async function handleSAMLCallback(params: {
  samlResponse: string;
  requestId: string;
  ssoConfigId: string;
}): Promise<{ userId: string; tenantId: string }> {
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
    tenantId: config.tenantId,
    provider: config.provider,
    autoProvision: config.autoProvision,
    defaultRoleId: config.defaultRoleId,
  });

  logger.info(`SSO SAML callback successful [user=${userId} provider=${config.provider}]`);
  return { userId, tenantId: config.tenantId };
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
    !config.issuerUrl
  ) {
    throw new SSOError("SSO configuration is missing or inactive", 400);
  }

  const oidcConfig = await discoverOIDCProvider({
    issuerUrl: config.issuerUrl,
    metadataUrl: config.metadataUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const claims = await exchangeCodeForClaims({
    config: oidcConfig,
    callbackUrl: params.callbackUrl,
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
      tenantId: config.tenantId,
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
      tenantId: config.tenantId,
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
  tenantId: string;
  provider: SSOProvider;
  autoProvision: boolean;
  defaultRoleId: string | null;
}): Promise<string> {
  const { claims, tenantId, provider, autoProvision, defaultRoleId } = params;

  // 1. Check existing SSOConnection
  const existingConnection = await prisma.sSOConnection.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: claims.sub } },
    include: {
      user: {
        select: { id: true, tenantId: true, userStatus: { select: { code: true } } },
      },
    },
  });

  if (existingConnection) {
    if (existingConnection.user.userStatus?.code !== "ACTIVE") {
      throw new SSOError("Your account is inactive. Contact your administrator.", 403);
    }
    if (existingConnection.user.tenantId !== tenantId) {
      throw new SSOError("Account is associated with a different organization.", 403);
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

  // 2. Check existing user by email (case-insensitive)
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: claims.email, mode: "insensitive" } },
    select: {
      id: true,
      tenantId: true,
      userStatus: { select: { code: true } },
    },
  });

  if (existingUser) {
    if (existingUser.tenantId && existingUser.tenantId !== tenantId) {
      throw new SSOError("An account with this email exists in a different organization.", 409);
    }
    if (existingUser.userStatus?.code !== "ACTIVE") {
      throw new SSOError("Your account is inactive. Contact your administrator.", 403);
    }

    await prisma.sSOConnection.create({
      data: {
        userId: existingUser.id,
        provider,
        providerUserId: claims.sub,
        tenantId,
        email: claims.email,
        displayName: claims.name,
        avatarUrl: claims.picture,
      },
    });

    logger.info(`SSO connection linked to existing user ${existingUser.id}`);
    return existingUser.id;
  }

  // 3. Auto-provision new user
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
        tenantId,
        userStatusId: activeStatus?.id,
      },
    });

    await tx.sSOConnection.create({
      data: {
        userId: newUser.id,
        provider,
        providerUserId: claims.sub,
        tenantId,
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
