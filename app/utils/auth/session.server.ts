import crypto from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";
import { prisma } from "~/utils/db/db.server";
import { sessionKey, unverifiedSessionIdKey, IMPERSONATION_TIMEOUT_MINUTES } from "./constants";
import { writeAudit } from "./audit.server";
import { extractClientIp } from "./ip-utils.server";

export const authSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "admin_session",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: process.env.SESSION_SECRET.split(","),
    secure: process.env.NODE_ENV === "production",
  },
});

// we have to do this because every time you commit the session you overwrite it
// so we store the expiration time in the cookie and reset it every time we commit
const originalCommitSession = authSessionStorage.commitSession;

Object.defineProperty(authSessionStorage, "commitSession", {
  value: async function commitSession(...args: Parameters<typeof originalCommitSession>) {
    const [session, options] = args;
    if (options?.expires) {
      session.set("expires", options.expires);
    }
    if (options?.maxAge) {
      session.set("expires", new Date(Date.now() + options.maxAge * 1000));
    }
    const expires = session.has("expires") ? new Date(session.get("expires")) : undefined;
    const setCookieHeader = await originalCommitSession(session, {
      ...options,
      expires,
    });
    return setCookieHeader;
  },
});

// ---------------------------------------------------------------------------
// Helpers added in Phase 1 Task 4
// ---------------------------------------------------------------------------

function getSessionFromRequest(request: Request) {
  return authSessionStorage.getSession(request.headers.get("cookie"));
}

/**
 * Require the user to be authenticated. Returns the full user record with
 * nested roles + permissions. Redirects to /login if not authenticated.
 */
export async function requireUser(request: Request) {
  const cookieSession = await getSessionFromRequest(request);
  const sessionId = cookieSession.get(sessionKey);
  if (!sessionId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", `${url.pathname}${url.search}`]]);
    throw redirect(`/login?${searchParams}`);
  }

  const session = await prisma.session.findUnique({
    select: { userId: true },
    where: { id: sessionId },
  });
  if (!session) {
    const searchParams = new URLSearchParams([["redirectTo", new URL(request.url).pathname]]);
    throw redirect(`/login?${searchParams}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      tenantId: true,
      userRoles: {
        select: {
          eventId: true,
          role: {
            select: {
              id: true,
              name: true,
              scope: true,
              rolePermissions: {
                select: {
                  access: true,
                  permission: { select: { resource: true, action: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    const searchParams = new URLSearchParams([["redirectTo", new URL(request.url).pathname]]);
    throw redirect(`/login?${searchParams}`);
  }

  return user;
}

/**
 * Redirect authenticated users away from anonymous-only pages (login, signup).
 */
export async function requireAnonymous(request: Request): Promise<void> {
  const cookieSession = await getSessionFromRequest(request);
  const sessionId = cookieSession.get(sessionKey);
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    select: { userId: true },
    where: { id: sessionId },
  });
  if (session?.userId) {
    throw redirect("/");
  }
}

// ---------------------------------------------------------------------------
// Impersonation helpers
// ---------------------------------------------------------------------------

const IMPERSONATING_USER_ID_KEY = "impersonatingUserId";
const ORIGINAL_USER_ID_KEY = "originalUserId";
const IMPERSONATION_STARTED_AT_KEY = "impersonationStartedAt";

/**
 * Start impersonating a target user. Stores the admin's original user ID and
 * the target user ID in the cookie session. Returns a Response (redirect).
 */
export async function startImpersonating(
  request: Request,
  targetUserId: string,
  redirectTo: string,
): Promise<Response> {
  const cookieSession = await getSessionFromRequest(request);
  const sessionId = cookieSession.get(sessionKey);

  const dbSession = await prisma.session.findUnique({
    select: { userId: true },
    where: { id: sessionId },
  });
  if (!dbSession) throw redirect("/login");

  const originalUserId = dbSession.userId;

  cookieSession.set(ORIGINAL_USER_ID_KEY, originalUserId);
  cookieSession.set(IMPERSONATING_USER_ID_KEY, targetUserId);
  cookieSession.set(IMPERSONATION_STARTED_AT_KEY, Date.now());

  await writeAudit({
    userId: originalUserId,
    actingAsUserId: targetUserId,
    action: "IMPERSONATE_START",
    entityType: "User",
    entityId: targetUserId,
    description: `Admin started impersonating user ${targetUserId}`,
    request,
  });

  return redirect(redirectTo, {
    headers: { "Set-Cookie": await authSessionStorage.commitSession(cookieSession) },
  });
}

/**
 * Stop impersonating and restore the admin's original session.
 * Returns a Response (redirect).
 */
export async function stopImpersonating(request: Request, redirectTo: string): Promise<Response> {
  const cookieSession = await getSessionFromRequest(request);

  const originalUserId = cookieSession.get(ORIGINAL_USER_ID_KEY) as string | undefined;
  const impersonatedUserId = cookieSession.get(IMPERSONATING_USER_ID_KEY) as string | undefined;

  cookieSession.unset(IMPERSONATING_USER_ID_KEY);
  cookieSession.unset(ORIGINAL_USER_ID_KEY);
  cookieSession.unset(IMPERSONATION_STARTED_AT_KEY);

  if (originalUserId && impersonatedUserId) {
    await writeAudit({
      userId: originalUserId,
      actingAsUserId: impersonatedUserId,
      action: "IMPERSONATE_STOP",
      entityType: "User",
      entityId: impersonatedUserId,
      description: `Admin stopped impersonating user ${impersonatedUserId}`,
      request,
    });
  }

  return redirect(redirectTo, {
    headers: { "Set-Cookie": await authSessionStorage.commitSession(cookieSession) },
  });
}

/**
 * Get the currently-impersonated user ID from the cookie session, if any.
 * Also enforces the impersonation timeout — clears state if expired.
 */
export async function getActingAsUserId(request: Request): Promise<string | null> {
  const cookieSession = await getSessionFromRequest(request);
  const impersonatingUserId = cookieSession.get(IMPERSONATING_USER_ID_KEY);
  if (!impersonatingUserId || typeof impersonatingUserId !== "string") return null;

  const startedAt = cookieSession.get(IMPERSONATION_STARTED_AT_KEY);
  const timeoutMs = IMPERSONATION_TIMEOUT_MINUTES * 60 * 1000;
  if (startedAt && Date.now() - Number(startedAt) > timeoutMs) {
    // Timeout — clean up silently (fire-and-forget audit)
    const originalUserId = cookieSession.get(ORIGINAL_USER_ID_KEY) as string | undefined;
    cookieSession.unset(IMPERSONATING_USER_ID_KEY);
    cookieSession.unset(ORIGINAL_USER_ID_KEY);
    cookieSession.unset(IMPERSONATION_STARTED_AT_KEY);
    void writeAudit({
      userId: originalUserId ?? null,
      actingAsUserId: impersonatingUserId,
      action: "IMPERSONATE_TIMEOUT",
      entityType: "User",
      entityId: impersonatingUserId,
      description: `Impersonation auto-stopped after ${IMPERSONATION_TIMEOUT_MINUTES} minute timeout`,
      request,
    });
    return null;
  }

  return impersonatingUserId;
}

/**
 * Check whether a raw session object has an active impersonation key set.
 * Useful for middleware / layout checks without an extra async call.
 */
export function isImpersonating(
  session: Awaited<ReturnType<typeof authSessionStorage.getSession>>,
): boolean {
  return !!session.get(IMPERSONATING_USER_ID_KEY);
}

/**
 * Get the current impersonation state (for admin UI banners etc.).
 */
export async function getImpersonationState(request: Request) {
  const cookieSession = await getSessionFromRequest(request);
  const impersonatingUserId = cookieSession.get(IMPERSONATING_USER_ID_KEY);
  const originalUserId = cookieSession.get(ORIGINAL_USER_ID_KEY);
  return {
    isImpersonating: !!impersonatingUserId,
    impersonatedUserId: impersonatingUserId as string | undefined,
    originalUserId: originalUserId as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// 2FA session-gating helpers (Task 7 builds the full flow on top of these)
// ---------------------------------------------------------------------------

/**
 * Cookie storage dedicated to the unverified (pre-2FA) session id.
 * Kept separate so it cannot be confused with a fully-authenticated session.
 */
const unverifiedSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "unverified_session",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: process.env.SESSION_SECRET.split(","),
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 minutes — enough time to complete 2FA
  },
});

/**
 * Retrieve the unverified session ID stored during 2FA pending state.
 * Returns null if not present.
 */
export async function getUnverifiedSessionId(request: Request): Promise<string | null> {
  const unverifiedSession = await unverifiedSessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const id = unverifiedSession.get(unverifiedSessionIdKey);
  return typeof id === "string" ? id : null;
}

/**
 * Store a session ID in the unverified-session cookie.
 * Returns the Set-Cookie header value — the caller must include it in the response.
 */
export async function setUnverifiedSessionId(sessionId: string): Promise<string> {
  const unverifiedSession = await unverifiedSessionStorage.getSession();
  unverifiedSession.set(unverifiedSessionIdKey, sessionId);
  return unverifiedSessionStorage.commitSession(unverifiedSession);
}

/**
 * Promote a session from "unverified" (pre-2FA) to "verified" (fully authenticated).
 * Clears the unverified cookie and sets the main session cookie.
 * Returns an array of Set-Cookie header values to merge into the response.
 */
export async function promoteUnverifiedToVerified(request: Request): Promise<string[]> {
  const unverifiedSession = await unverifiedSessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const sessionId = unverifiedSession.get(unverifiedSessionIdKey);
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("No unverified session id to promote");
  }

  // Destroy unverified cookie
  const destroyUnverifiedCookie = await unverifiedSessionStorage.destroySession(unverifiedSession);

  // Set verified session
  const verifiedSession = await authSessionStorage.getSession();
  verifiedSession.set(sessionKey, sessionId);
  const setVerifiedCookie = await authSessionStorage.commitSession(verifiedSession);

  return [destroyUnverifiedCookie, setVerifiedCookie];
}

// ---------------------------------------------------------------------------
// Internal: fingerprint generation (kept local — not exported)
// ---------------------------------------------------------------------------

export function generateSessionFingerprint(request: Request): string {
  const components = [
    request.headers.get("user-agent") || "",
    request.headers.get("accept-language") || "",
  ];
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(components.join("|"))
    .digest("hex");
}
