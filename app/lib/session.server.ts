import { createCookieSessionStorage } from "react-router";
import prisma from "./prisma";

export const authSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "authSession",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secrets: process.env.SESSION_SECRET.split(","),
    secure: process.env.NODE_ENV === "production",
  },
});

// Database-based session storage for large tokens
export async function getDBSession(sessionId: string) {
  return await prisma.userSession.findUnique({
    where: { sessionId },
    include: { user: true },
  });
}

export async function getUserSessions(userId: string) {
  return await prisma.userSession.findMany({
    where: { userId },
    include: { user: true },
  });
}

export async function createDBSession(
  sessionId: string,
  userEmail: string,
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  }
) {
  // Find or create user
  let user = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: userEmail,
        role: "USER",
      },
    });
  }

  return await prisma.userSession.create({
    data: {
      sessionId,
      userId: user.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
    include: { user: true },
  });
}

export async function updateDBSession(
  sessionId: string,
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  }
) {
  return await prisma.userSession.update({
    where: { sessionId },
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
    include: { user: true },
  });
}

export async function deleteDBSession(sessionId: string) {
  try {
    return await prisma.userSession.delete({
      where: { sessionId },
    });
  } catch (error: any) {
    // Ignore "not found" error (P2025)
    if (error.code === "P2025") {
      return null;
    }
    throw error;
  }
}

export async function cleanupExpiredSessions() {
  const result = await prisma.userSession.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lt: new Date(),
          },
        },
        {
          updatedAt: {
            lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
          },
        },
      ],
    },
  });

  console.log(`Cleaned up ${result.count} expired sessions`);
  return result;
}
