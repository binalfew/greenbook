import crypto from "node:crypto";
import * as samlify from "samlify";

// ─── SAML Wrapper ────────────────────────────────────────
// Wraps samlify for SP-initiated SAML 2.0 flows.
// Handles: AuthnRequest generation, Response validation, claim extraction.

// samlify requires a schema validator — use a permissive one
// (signature validation is done by samlify internally via xml-crypto)
samlify.setSchemaValidator({
  validate: async () => "skipped",
});

export interface SAMLProviderConfig {
  issuerUrl: string; // IdP Entity ID
  x509Certificate: string; // PEM-encoded signing certificate
  ssoUrl: string; // IdP SSO endpoint
  callbackUrl: string; // SP ACS URL
  spEntityId: string; // SP Entity ID
  nameIdFormat?: string;
}

export interface SAMLUserClaims {
  nameId: string;
  email: string;
  name?: string;
  sessionIndex?: string;
}

// ─── Generate Request ID ─────────────────────────────────

export function generateRequestId(): string {
  return `_${crypto.randomUUID()}`;
}

// ─── Generate State ──────────────────────────────────────

export function generateSAMLState(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Build Authorization URL ─────────────────────────────

export async function buildSAMLRedirectUrl(
  config: SAMLProviderConfig,
  requestId: string,
  relayState: string,
): Promise<string> {
  const idp = samlify.IdentityProvider({
    entityID: config.issuerUrl,
    singleSignOnService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: config.ssoUrl,
      },
    ],
    signingCert: config.x509Certificate,
  });

  const sp = samlify.ServiceProvider({
    entityID: config.spEntityId,
    assertionConsumerService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: config.callbackUrl,
      },
    ],
    nameIDFormat: [config.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"],
  });

  const { context } = sp.createLoginRequest(idp, "redirect");
  // Append RelayState to the redirect URL
  const url = new URL(context);
  url.searchParams.set("RelayState", relayState);
  return url.toString();
}

// ─── Validate SAML Response ──────────────────────────────

export async function validateSAMLResponse(
  config: SAMLProviderConfig,
  samlResponseBody: string,
  _requestId: string,
): Promise<SAMLUserClaims> {
  const idp = samlify.IdentityProvider({
    entityID: config.issuerUrl,
    singleSignOnService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: config.ssoUrl,
      },
    ],
    signingCert: config.x509Certificate,
  });

  const sp = samlify.ServiceProvider({
    entityID: config.spEntityId,
    assertionConsumerService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: config.callbackUrl,
      },
    ],
  });

  const { extract } = await sp.parseLoginResponse(idp, "post", {
    body: { SAMLResponse: samlResponseBody },
  });

  if (!extract) {
    throw new Error("SAML Response validation failed: no data extracted");
  }

  const nameId = extract.nameID;
  const attributes = extract.attributes || {};
  const email =
    attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ||
    attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
    attributes.email ||
    nameId;

  if (!email) {
    throw new Error("SAML Response did not contain an email");
  }

  const firstName =
    attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"] ||
    attributes.firstName;
  const lastName =
    attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"] ||
    attributes.lastName;
  const displayName =
    attributes["http://schemas.microsoft.com/identity/claims/displayname"] ||
    attributes.displayName;

  return {
    nameId: nameId || email,
    email,
    name: firstName && lastName ? `${firstName} ${lastName}` : displayName,
    sessionIndex: extract.sessionIndex,
  };
}

// ─── Test SAML Configuration ─────────────────────────────

export function testSAMLConfiguration(config: SAMLProviderConfig): {
  success: boolean;
  error?: string;
} {
  try {
    const certClean = config.x509Certificate
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s/g, "");

    if (!certClean || certClean.length < 100) {
      return { success: false, error: "X.509 certificate appears invalid or too short" };
    }

    const decoded = Buffer.from(certClean, "base64");
    if (decoded.length === 0) {
      return { success: false, error: "X.509 certificate is not valid base64" };
    }

    if (!config.ssoUrl) {
      return { success: false, error: "IdP SSO URL is required" };
    }
    if (!config.issuerUrl) {
      return { success: false, error: "IdP Entity ID (Issuer URL) is required" };
    }

    samlify.IdentityProvider({
      entityID: config.issuerUrl,
      singleSignOnService: [
        {
          Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
          Location: config.ssoUrl,
        },
      ],
      signingCert: config.x509Certificate,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: `SAML configuration error: ${message}` };
  }
}
