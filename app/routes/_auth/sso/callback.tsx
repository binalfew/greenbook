import { AlertCircle, Shield } from "lucide-react";
import { Link, data, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import {
  SSOError,
  handleSSOCallback,
  linkSAMLAccount,
  linkSSOAccount,
} from "~/services/sso.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { getSessionExpirationDate } from "~/utils/auth/auth.server";
import { sessionKey } from "~/utils/auth/constants";
import { authSessionStorage } from "~/utils/auth/session.server";
import {
  decodeSAMLRelayState,
  destroySSOState,
  getSSOFlowState,
} from "~/utils/auth/sso-state.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/callback";

async function createSessionAndRedirect(args: {
  userId: string;
  redirectTo: string;
  destroyCookieHeader?: string;
}): Promise<Response> {
  // Replace any existing sessions for this user (single-session model)
  await prisma.session.deleteMany({ where: { userId: args.userId } });
  const dbSession = await prisma.session.create({
    data: {
      userId: args.userId,
      expiresAt: getSessionExpirationDate(),
    },
  });

  const newSession = await authSessionStorage.getSession();
  newSession.set(sessionKey, dbSession.id);
  const sessionCookie = await authSessionStorage.commitSession(newSession);

  const headers: [string, string][] = [["Set-Cookie", sessionCookie]];
  if (args.destroyCookieHeader) {
    headers.push(["Set-Cookie", args.destroyCookieHeader]);
  }
  return redirect(args.redirectTo, { headers });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);

  // IdP error response
  const idpError = url.searchParams.get("error");
  if (idpError) {
    const description = url.searchParams.get("error_description") ?? idpError;
    console.warn(`IdP returned error: ${idpError} — ${description}`);
    return data({ error: `Identity provider error: ${description}` }, { status: 400 });
  }

  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return data({ error: "Missing authorization code or state parameter" }, { status: 400 });
  }

  const flowState = await getSSOFlowState(request);
  if (!flowState) {
    return data({ error: "SSO session expired. Please try again." }, { status: 400 });
  }

  if (flowState.state !== stateParam) {
    console.warn(`SSO state mismatch (expected=${flowState.state} got=${stateParam})`);
    return data({ error: "Invalid state parameter. Please try again." }, { status: 400 });
  }

  const destroyCookie = await destroySSOState(request);

  // ─── Link Mode: connect provider to current user ────────
  if (flowState.mode === "link" && flowState.linkUserId) {
    try {
      await linkSSOAccount({
        code,
        callbackUrl: url,
        codeVerifier: flowState.codeVerifier,
        nonce: flowState.nonce,
        state: flowState.state,
        ssoConfigId: flowState.ssoConfigId,
        userId: flowState.linkUserId,
      });

      return redirect(flowState.redirectTo || `/${flowState.tenantSlug}/profile`, {
        headers: [["Set-Cookie", destroyCookie]],
      });
    } catch (error) {
      const message = error instanceof SSOError ? error.message : "Failed to link account";
      console.error("SSO link failed", error);
      return data({ error: message, tenantSlug: flowState.tenantSlug }, { status: 400 });
    }
  }

  // ─── Login Mode ─────────────────────────────────────────
  try {
    const { userId } = await handleSSOCallback({
      protocol: flowState.protocol,
      code,
      callbackUrl: url,
      codeVerifier: flowState.codeVerifier,
      nonce: flowState.nonce,
      state: flowState.state,
      ssoConfigId: flowState.ssoConfigId,
    });

    await writeAudit({
      tenantId: flowState.tenantId,
      userId,
      action: "LOGIN",
      entityType: "user",
      entityId: userId,
      description: "SSO login successful",
      metadata: { method: "sso", tenantSlug: flowState.tenantSlug },
      request,
    });

    const redirectTo = flowState.redirectTo || `/${flowState.tenantSlug}`;
    return createSessionAndRedirect({
      userId,
      redirectTo,
      destroyCookieHeader: destroyCookie,
    });
  } catch (error) {
    const message = error instanceof SSOError ? error.message : "SSO authentication failed";
    console.error("SSO callback failed", error);

    void writeAudit({
      tenantId: flowState.tenantId,
      userId: null,
      action: "LOGIN",
      entityType: "user",
      entityId: null,
      description: `SSO login failed: ${message}`,
      metadata: { method: "sso", tenantSlug: flowState.tenantSlug, error: message },
      request,
    });

    return data({ error: message, tenantSlug: flowState.tenantSlug }, { status: 400 });
  }
}

// ─── SAML POST callback ──────────────────────────────────
// SAML IdPs POST the response (unlike OIDC which redirects via GET).
// Flow state is encoded in RelayState (not cookies, since cross-origin
// POST doesn't send sameSite=lax cookies).
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const samlResponse = formData.get("SAMLResponse") as string | null;
  const relayState = formData.get("RelayState") as string | null;

  if (!samlResponse) {
    return data({ error: "Missing SAML Response" }, { status: 400 });
  }

  const flowState = relayState ? decodeSAMLRelayState(relayState) : null;
  if (!flowState) {
    return data({ error: "SSO session expired. Please try again." }, { status: 400 });
  }

  try {
    if (flowState.mode === "link" && flowState.linkUserId) {
      await linkSAMLAccount({
        samlResponse,
        requestId: flowState.requestId || "",
        ssoConfigId: flowState.ssoConfigId,
        userId: flowState.linkUserId,
      });

      return redirect(flowState.redirectTo || `/${flowState.tenantSlug}/profile`);
    }

    const { userId } = await handleSSOCallback({
      protocol: "SAML",
      samlResponse,
      requestId: flowState.requestId || "",
      ssoConfigId: flowState.ssoConfigId,
    });

    await writeAudit({
      tenantId: flowState.tenantId,
      userId,
      action: "LOGIN",
      entityType: "user",
      entityId: userId,
      description: "SSO SAML login successful",
      metadata: { method: "sso-saml", tenantSlug: flowState.tenantSlug },
      request,
    });

    const redirectTo = flowState.redirectTo || `/${flowState.tenantSlug}`;
    return createSessionAndRedirect({ userId, redirectTo });
  } catch (error) {
    const message = error instanceof SSOError ? error.message : "SAML authentication failed";
    console.error("SAML callback failed", error);

    void writeAudit({
      tenantId: flowState.tenantId,
      userId: null,
      action: "LOGIN",
      entityType: "user",
      entityId: null,
      description: `SAML login failed: ${message}`,
      metadata: { method: "sso-saml", tenantSlug: flowState.tenantSlug, error: message },
      request,
    });

    return data({ error: message, tenantSlug: flowState.tenantSlug }, { status: 400 });
  }
}

export default function SSOCallbackPage({ loaderData }: Route.ComponentProps) {
  const { error, tenantSlug } = loaderData as { error: string; tenantSlug?: string };
  const loginUrl = tenantSlug
    ? `/login?tenant=${encodeURIComponent(tenantSlug)}&error=${encodeURIComponent(error)}`
    : `/login?error=${encodeURIComponent(error)}`;

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center space-y-6 text-center">
        <div className="bg-destructive/10 flex size-16 items-center justify-center rounded-full">
          <AlertCircle className="text-destructive size-8" />
        </div>

        <div>
          <h2 className="text-foreground text-2xl font-bold">Sign-in Failed</h2>
          <p className="text-muted-foreground mt-2 text-sm">{error}</p>
        </div>

        <Button asChild className="w-full">
          <Link to={loginUrl}>
            <Shield className="mr-2 size-4" />
            Back to Login
          </Link>
        </Button>
      </div>
    </div>
  );
}
