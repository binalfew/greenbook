import crypto from "node:crypto";
import { createCookieSessionStorage } from "react-router";
import { logger } from "~/utils/monitoring/logger.server";

// ─── SSO State Cookie ────────────────────────────────────
// Stores PKCE code_verifier, state, nonce, and tenant info
// during the OIDC authorization flow. Short-lived (10 min).

export const ssoStateStorage = createCookieSessionStorage({
  cookie: {
    name: "__sso_state",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: process.env.SESSION_SECRET.split(","),
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60, // 10 minutes
  },
});

export interface SSOFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  tenantId: string;
  tenantSlug: string;
  redirectTo: string;
  mode: "login" | "link";
  protocol: "OIDC" | "SAML";
  ssoConfigId: string;
  linkUserId?: string;
  requestId?: string; // SAML InResponseTo validation
}

export async function getSSOStateSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return ssoStateStorage.getSession(cookie);
}

export async function setSSOFlowState(request: Request, flowState: SSOFlowState): Promise<string> {
  const session = await getSSOStateSession(request);
  session.set("state", flowState.state);
  session.set("nonce", flowState.nonce);
  session.set("codeVerifier", flowState.codeVerifier);
  session.set("tenantId", flowState.tenantId);
  session.set("tenantSlug", flowState.tenantSlug);
  session.set("redirectTo", flowState.redirectTo);
  session.set("mode", flowState.mode);
  session.set("protocol", flowState.protocol);
  session.set("ssoConfigId", flowState.ssoConfigId);
  if (flowState.linkUserId) session.set("linkUserId", flowState.linkUserId);
  if (flowState.requestId) session.set("requestId", flowState.requestId);
  return ssoStateStorage.commitSession(session);
}

export async function getSSOFlowState(request: Request): Promise<SSOFlowState | null> {
  const session = await getSSOStateSession(request);
  const state = session.get("state");
  if (!state) return null;

  return {
    state: session.get("state"),
    nonce: session.get("nonce"),
    codeVerifier: session.get("codeVerifier"),
    tenantId: session.get("tenantId"),
    tenantSlug: session.get("tenantSlug"),
    redirectTo: session.get("redirectTo"),
    mode: session.get("mode") ?? "login",
    protocol: session.get("protocol") ?? "OIDC",
    ssoConfigId: session.get("ssoConfigId"),
    linkUserId: session.get("linkUserId"),
    requestId: session.get("requestId"),
  };
}

export async function destroySSOState(request: Request): Promise<string> {
  const session = await getSSOStateSession(request);
  return ssoStateStorage.destroySession(session);
}

// ─── SAML RelayState Encoding ────────────────────────────
// SAML callbacks are cross-origin POSTs so sameSite=lax cookies
// are not sent. We encode the flow state into the RelayState
// parameter (signed with HMAC to prevent tampering).

function signRelayState(payload: string): string {
  const secret = process.env.SESSION_SECRET.split(",")[0];
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${sig}.${payload}`;
}

function verifyRelayState(relayState: string): string | null {
  const dotIndex = relayState.indexOf(".");
  if (dotIndex < 0) return null;
  const sig = relayState.slice(0, dotIndex);
  const payload = relayState.slice(dotIndex + 1);
  const secret = process.env.SESSION_SECRET.split(",")[0];
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return payload;
}

const RELAY_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function encodeSAMLRelayState(flowState: SSOFlowState): string {
  const payload = Buffer.from(
    JSON.stringify({
      t: flowState.tenantId,
      s: flowState.tenantSlug,
      r: flowState.redirectTo,
      m: flowState.mode,
      c: flowState.ssoConfigId,
      q: flowState.requestId,
      u: flowState.linkUserId,
      e: Date.now() + RELAY_STATE_MAX_AGE_MS,
    }),
  ).toString("base64url");
  return signRelayState(payload);
}

export function decodeSAMLRelayState(relayState: string): SSOFlowState | null {
  const payload = verifyRelayState(relayState);
  if (!payload) {
    logger.warn("SAML RelayState signature verification failed");
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());

    if (!data.c || !data.t) {
      logger.warn("SAML RelayState missing required fields", data);
      return null;
    }

    if (data.e && Date.now() > data.e) {
      logger.warn("SAML RelayState expired");
      return null;
    }

    return {
      state: "",
      nonce: "",
      codeVerifier: "",
      tenantId: data.t,
      tenantSlug: data.s,
      redirectTo: data.r || "",
      mode: data.m || "login",
      protocol: "SAML",
      ssoConfigId: data.c,
      requestId: data.q,
      linkUserId: data.u,
    };
  } catch {
    logger.warn("SAML RelayState JSON parse failed");
    return null;
  }
}
