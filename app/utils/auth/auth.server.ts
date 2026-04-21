import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addMinutes, isBefore } from "date-fns";
import { redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { type Password, type User } from "~/generated/prisma/client";
import { AUTH_SETTINGS, MAX_PASSWORD_HISTORY, PASSWORD_EXPIRY_DAYS, sessionKey } from "./constants";
import { prisma } from "../db/db.server";
import { authSessionStorage, getActingAsUserId } from "./session.server";
import { combineResponses } from "../misc";
import { writeAudit } from "./audit.server";

const SESSION_EXPIRATION_TIME = 1000 * 60 * 60 * 24 * 30; // 30 days

export const getSessionExpirationDate = () => new Date(Date.now() + SESSION_EXPIRATION_TIME);

export async function verifyUserPassword(
  where: Pick<User, "email"> | Pick<User, "id">,
  password: Password["hash"],
  request?: Request,
) {
  const userWithPassword = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      tenantId: true,
      userStatus: { select: { name: true } },
      failedLoginAttempts: true,
      lastFailedLoginAt: true,
      autoUnlockAt: true,
      lockCount: true,
      password: { select: { hash: true } },
    },
  });

  if (!userWithPassword || !userWithPassword.password) {
    return null;
  }

  // Check if account is locked
  if (userWithPassword.userStatus?.name === "LOCKED") {
    // If lock count is too high, require manual intervention
    if (userWithPassword.lockCount >= AUTH_SETTINGS.MAX_LOCK_COUNT) {
      throw new Error(
        "Account is permanently locked due to multiple security violations. Please contact an administrator.",
      );
    }

    if (userWithPassword.autoUnlockAt && isBefore(new Date(), userWithPassword.autoUnlockAt)) {
      throw new Error("Account is locked. Please try again later.");
    } else if (
      userWithPassword.autoUnlockAt &&
      isBefore(userWithPassword.autoUnlockAt, new Date())
    ) {
      // Auto-unlock the account if lockout duration has passed and lock count is below threshold
      await prisma.user.update({
        where: { id: userWithPassword.id },
        data: {
          userStatus: { update: { name: "ACTIVE" } },
          failedLoginAttempts: 0,
          lockedAt: null,
          lockReason: null,
          autoUnlockAt: null,
        },
      });
    }
  }

  // Check if we should reset failed attempts due to time passed
  if (
    userWithPassword.lastFailedLoginAt &&
    isBefore(
      addMinutes(userWithPassword.lastFailedLoginAt, AUTH_SETTINGS.AUTO_RESET_AFTER),
      new Date(),
    )
  ) {
    await prisma.user.update({
      where: { id: userWithPassword.id },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      },
    });
  }

  const isValid = await bcrypt.compare(password, userWithPassword.password.hash);

  if (!isValid) {
    // Increment failed attempts
    const failedAttempts = (userWithPassword.failedLoginAttempts || 0) + 1;
    const updates = {
      failedLoginAttempts: failedAttempts,
      lastFailedLoginAt: new Date(),
      lockedAt: undefined as Date | undefined,
      lockReason: undefined as string | undefined,
      lockCount: undefined as number | undefined,
      autoUnlockAt: undefined as Date | null | undefined,
    };

    // Lock account if max attempts reached
    if (failedAttempts >= AUTH_SETTINGS.MAX_LOGIN_ATTEMPTS) {
      const finalLockCount = (userWithPassword.lockCount || 0) + 1;
      updates.lockedAt = new Date();
      updates.lockReason = "Too many failed login attempts";
      updates.lockCount = finalLockCount;
      updates.autoUnlockAt =
        finalLockCount >= AUTH_SETTINGS.MAX_LOCK_COUNT
          ? null // No auto-unlock for accounts locked too many times
          : addMinutes(new Date(), AUTH_SETTINGS.LOCKOUT_DURATION);
    }

    await prisma.user.update({
      where: { id: userWithPassword.id },
      data: {
        ...updates,
        userStatus:
          failedAttempts >= AUTH_SETTINGS.MAX_LOGIN_ATTEMPTS
            ? { update: { name: "LOCKED" } }
            : undefined,
      },
    });

    if (failedAttempts >= AUTH_SETTINGS.MAX_LOGIN_ATTEMPTS) {
      const finalLockCount = (userWithPassword.lockCount || 0) + 1;
      await writeAudit({
        userId: userWithPassword.id,
        action: "ACCOUNT_LOCKED",
        entityType: "user",
        entityId: userWithPassword.id,
        description: `Account locked after ${failedAttempts} failed attempts`,
        metadata: { lockCount: finalLockCount },
        request,
      });
      const message =
        finalLockCount >= AUTH_SETTINGS.MAX_LOCK_COUNT
          ? "Account has been permanently locked due to multiple security violations. Please contact an administrator."
          : `Account locked due to too many failed attempts. Please try again after ${AUTH_SETTINGS.LOCKOUT_DURATION} minutes.`;
      throw new Error(message);
    }

    return null;
  }

  // Reset failed attempts on successful login
  if (userWithPassword.failedLoginAttempts > 0) {
    await prisma.user.update({
      where: { id: userWithPassword.id },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      },
    });
  }

  return { id: userWithPassword.id, tenantId: userWithPassword.tenantId };
}

export async function getPasswordHash(password: string) {
  const hash = await bcrypt.hash(password, 10);
  return hash;
}

/**
 * Check whether a plaintext password matches any of the last `count` hashes
 * stored in the user's password history. Used to enforce the no-reuse policy.
 */
export async function isPasswordInHistory(
  userId: string,
  plaintext: string,
  count = MAX_PASSWORD_HISTORY,
): Promise<boolean> {
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: count,
    select: { hash: true },
  });
  if (history.length === 0) return false;
  const results = await Promise.all(history.map((entry) => bcrypt.compare(plaintext, entry.hash)));
  return results.some(Boolean);
}

export async function addPasswordToHistory(userId: string, passwordHash: string): Promise<void> {
  await prisma.passwordHistory.create({ data: { userId, hash: passwordHash } });
}

/**
 * Returns true if the password has not been rotated within `maxAgeDays`
 * (defaults to the template-wide expiry constant).
 */
export function isPasswordExpired(lastChanged: Date, maxAgeDays = PASSWORD_EXPIRY_DAYS): boolean {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastChanged.getTime() > maxAgeMs;
}

export async function signup({
  email,
  password,
  firstName,
  lastName,
  tenantName,
  request,
}: {
  email: User["email"];
  firstName: User["firstName"];
  lastName: User["lastName"];
  password: string;
  tenantName: string;
  request: Request;
}) {
  const { generateUniqueSlug } = await import("~/services/tenants.server");
  const { bootstrapNewTenant } = await import("~/services/tenant-setup.server");

  const slug = await generateUniqueSlug(tenantName);
  const hashedPassword = await getPasswordHash(password);
  const metadata = {
    fingerprint: generateFingerprint(request),
  };

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      slug,
      email: email.toLowerCase(),
      phone: "",
      city: "",
      state: "",
      address: "",
    },
    select: { id: true, slug: true, name: true },
  });

  const session = await prisma.session.create({
    select: { id: true, expiresAt: true, userId: true },
    data: {
      expiresAt: getSessionExpirationDate(),
      metadata,
      user: {
        create: {
          email: email.toLowerCase(),
          firstName,
          lastName,
          tenantId: tenant.id,
          password: {
            create: { hash: hashedPassword },
          },
        },
      },
    },
  });

  // Attach the signing-up user as the tenant admin with a tenant-scoped role
  // set mirroring the seed baseline.
  await bootstrapNewTenant({
    tenantId: tenant.id,
    initialAdminUserId: session.userId,
  });

  await writeAudit({
    tenantId: tenant.id,
    userId: session.userId,
    action: "CREATE",
    entityType: "user",
    entityId: session.userId,
    description: `User signed up and bootstrapped tenant "${tenant.name}"`,
    request,
  });

  const { emitUserCreated } = await import("~/utils/events/emit-user-created.server");
  emitUserCreated({ id: session.userId, email: email.toLowerCase() }, tenant.id, {
    source: "signup",
    tenantName: tenant.name,
  });

  return { session, tenant };
}

export async function login({
  email,
  password,
  request,
}: {
  email: User["email"];
  password: string;
  request: Request;
}) {
  const user = await verifyUserPassword({ email }, password, request);
  if (!user) return null;

  const metadata = {
    fingerprint: generateFingerprint(request),
  };

  const session = await prisma.session.create({
    select: { id: true, userId: true, expiresAt: true },
    data: {
      userId: user.id,
      expiresAt: getSessionExpirationDate(),
      metadata,
    },
  });

  return session;
}

export async function logout(
  {
    request,
    redirectTo = "/",
  }: {
    request: Request;
    redirectTo?: string;
  },
  responseInit?: ResponseInit,
) {
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));

  const sessionId = cookieSession.get(sessionKey);
  const session = await prisma.session.findUnique({
    select: { userId: true },
    where: { id: sessionId },
  });

  if (session?.userId) {
    await writeAudit({
      userId: session.userId,
      action: "LOGOUT",
      entityType: "user",
      entityId: session.userId,
      description: "User logged out",
      request,
    });
  }

  void prisma.session.delete({ where: { id: sessionId } }).catch(() => {});

  throw redirect(
    safeRedirect(redirectTo),
    combineResponses(responseInit, {
      headers: {
        "set-cookie": await authSessionStorage.destroySession(cookieSession),
      },
    }),
  );
}

function generateFingerprint(request: Request): string {
  // Intentionally only UA + accept-language — they're universally sent on
  // every request. Client hints like `sec-ch-ua` are NOT stable: Chromium
  // omits them on various navigations/fetches depending on permissions
  // policy, which caused the fingerprint to flip between requests and
  // forced logouts on refresh.
  const components = [
    request.headers.get("user-agent") || "",
    request.headers.get("accept-language") || "",
  ];

  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(components.join("|"))
    .digest("hex");
}

export async function getUserId(request: Request) {
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const sessionId = cookieSession.get(sessionKey);
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    select: { userId: true, metadata: true },
    where: { id: sessionId },
  });

  if (!session) {
    throw await logout({ request });
  }

  const currentFingerprint = generateFingerprint(request);
  const sessionMetadata = session.metadata as { fingerprint: string } | null;

  if (sessionMetadata?.fingerprint && currentFingerprint !== sessionMetadata.fingerprint) {
    throw await logout({ request });
  }

  // If an admin is impersonating another user, downstream code sees the target.
  // The original admin id stays available via getImpersonationState for banners
  // and audit attribution.
  const actingAsUserId = await getActingAsUserId(request);
  return actingAsUserId ?? session.userId;
}

export async function requireUserId(
  request: Request,
  { redirectTo }: { redirectTo?: string | null } = {},
) {
  const userId = await getUserId(request);
  if (!userId) {
    const requestUrl = new URL(request.url);
    redirectTo =
      redirectTo === null ? null : (redirectTo ?? `${requestUrl.pathname}${requestUrl.search}`);
    const loginParams = redirectTo ? new URLSearchParams({ redirectTo }) : null;
    const loginRedirect = ["/login", loginParams?.toString()].filter(Boolean).join("?");
    throw redirect(loginRedirect);
  }

  return userId;
}

// getUser has moved to services/users.server.ts
// Re-exported here for backward-compatibility so existing imports (e.g. root.tsx) continue to work.
export { getUser } from "~/services/users.server";

// requireAnonymous has moved to session.server.ts
// Re-exported here for backward-compatibility so existing route imports continue to work.
export { requireAnonymous } from "./session.server";

export async function resetUserPassword({
  email,
  password,
  request,
}: {
  email: User["email"];
  password: string;
  request?: Request;
}) {
  const hashedPassword = await bcrypt.hash(password, 10);

  // First check if the user has a password entry
  const user = await prisma.user.findUnique({
    where: { email },
    include: { password: true },
  });

  if (!user) {
    throw new Error(`User with email ${email} not found`);
  }

  // If the user has an existing password, update it
  let result;
  if (user.password) {
    // Enforce no-reuse against the last N hashes (template default: 5).
    if (await isPasswordInHistory(user.id, password)) {
      throw new Error("You cannot reuse a recent password. Please choose a different one.");
    }
    // Snapshot the outgoing hash into history before we overwrite it.
    await addPasswordToHistory(user.id, user.password.hash);
    result = await prisma.user.update({
      select: { id: true },
      where: { email },
      data: {
        password: {
          update: {
            hash: hashedPassword,
            lastChanged: new Date(),
          },
        },
      },
    });
  }
  // If the user doesn't have a password entry yet, create one
  else {
    result = await prisma.user.update({
      select: { id: true },
      where: { email },
      data: {
        password: {
          create: {
            hash: hashedPassword,
          },
        },
      },
    });
  }

  await writeAudit({
    userId: result.id,
    action: "PASSWORD_RESET",
    entityType: "user",
    entityId: result.id,
    description: "User reset password",
    request,
  });

  return result;
}
