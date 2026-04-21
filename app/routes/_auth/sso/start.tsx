import { redirect } from "react-router";
import { SSOError, initiateSSOFlow } from "~/services/sso.server";
import { sessionKey } from "~/utils/auth/constants";
import { authSessionStorage } from "~/utils/auth/session.server";
import { encodeSAMLRelayState, setSSOFlowState } from "~/utils/auth/sso-state.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/start";

// Loader-only route — redirects to the IdP authorization URL.
// Supports two modes:
//   Login:  /sso/start?tenant=acme&configId=xxx
//   Link:   /sso/start?tenant=acme&configId=xxx&link=true  (requires active session)

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const sessionId = cookieSession.get(sessionKey);
  if (!sessionId) return null;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  return session?.userId ?? null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tenantSlug = url.searchParams.get("tenant");
  const configId = url.searchParams.get("configId");
  const rawRedirectTo = url.searchParams.get("redirectTo") ?? "";
  const redirectTo = rawRedirectTo.startsWith("/") ? rawRedirectTo : "";
  const isLinkMode = url.searchParams.get("link") === "true";

  if (!tenantSlug || !configId) {
    return redirect("/login?error=missing_tenant");
  }

  let linkUserId: string | undefined;
  if (isLinkMode) {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return redirect(`/login?tenant=${encodeURIComponent(tenantSlug)}&error=session_expired`);
    }
    linkUserId = userId;
  }

  try {
    const result = await initiateSSOFlow(configId, tenantSlug, redirectTo);

    const flowState = {
      state: result.state,
      nonce: result.nonce,
      codeVerifier: result.codeVerifier,
      tenantId: result.tenantId,
      tenantSlug: result.tenantSlug,
      redirectTo: isLinkMode ? `/${tenantSlug}/profile` : redirectTo,
      mode: (isLinkMode ? "link" : "login") as "login" | "link",
      protocol: result.protocol,
      ssoConfigId: result.ssoConfigId,
      linkUserId,
      requestId: result.requestId,
    };

    if (result.protocol === "SAML") {
      // SAML: encode state into RelayState (cookies don't survive cross-origin POST)
      const relayState = encodeSAMLRelayState(flowState);
      const samlUrl = new URL(result.authorizationUrl);
      samlUrl.searchParams.set("RelayState", relayState);
      return redirect(samlUrl.toString());
    }

    // OIDC: use cookie (same-origin GET callback)
    const setCookie = await setSSOFlowState(request, flowState);
    return redirect(result.authorizationUrl, {
      headers: { "Set-Cookie": setCookie },
    });
  } catch (error) {
    const message = error instanceof SSOError ? error.message : "SSO initialization failed";
    console.error("SSO start failed", error);
    return redirect(
      `/login?error=${encodeURIComponent(message)}&tenant=${encodeURIComponent(tenantSlug)}`,
    );
  }
}
