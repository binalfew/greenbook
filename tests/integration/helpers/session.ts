import type { PrismaClient } from "../../../app/generated/prisma/client.js";
import { authSessionStorage } from "~/utils/auth/session.server";
import { sessionKey } from "~/utils/auth/constants";

// Helper: create a real DB Session row + return a `Cookie:` header value so
// route tests can invoke actions as a logged-in user. Used by integration
// tests that exercise route action handlers (not the unit-level service
// layer).
export async function createSessionCookie(prisma: PrismaClient, userId: string): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const cookieSession = await authSessionStorage.getSession();
  cookieSession.set(sessionKey, session.id);
  const setCookie = await authSessionStorage.commitSession(cookieSession, {
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  // commitSession returns a full `Set-Cookie` header; extract the name=value.
  return setCookie.split(";")[0];
}
