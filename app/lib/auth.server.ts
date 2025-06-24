import { redirect } from "react-router";
import { Authenticator } from "remix-auth";
import { MicrosoftStrategy } from "remix-auth-microsoft";
import prisma from "./prisma";
import {
  authSessionStorage,
  deleteDBSession,
  getDBSession,
  updateDBSession,
} from "./session.server";

const SESSION_EXPIRATION_TIME = 1000 * 60 * 60 * 24 * 30; // 30 days
export const getSessionExpirationDate = () =>
  new Date(Date.now() + SESSION_EXPIRATION_TIME);

export const userIdKey = "userId";
export const sessionIdKey = "sessionId";

export type ProviderUser = {
  id: string;
  email: string;
  username: string;
  name?: string;
  imageUrl?: string;
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
};

export const authenticator = new Authenticator<ProviderUser>();

let microsoftStrategy = new MicrosoftStrategy(
  {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    tenantId: process.env.MICROSOFT_TENANT_ID,
    redirectURI: process.env.MICROSOFT_REDIRECT_URI,
    scopes: ["openid", "profile", "email", "User.Read", "offline_access"],
    prompt: "login",
  },
  async ({ tokens }) => {
    let accessToken = tokens.accessToken();
    let profile = await MicrosoftStrategy.userProfile(accessToken);
    const email = profile.emails?.[0]?.value.trim().toLowerCase();
    if (!email) {
      throw redirect("/login");
    }

    // Get token expiration time using the correct method
    const expiresAt = tokens.accessTokenExpiresAt()?.getTime();

    // Get refresh token if available
    const refreshToken = tokens.hasRefreshToken()
      ? tokens.refreshToken()
      : undefined;

    return {
      id: profile.id,
      email,
      username: profile.displayName,
      name: profile.name.givenName,
      accessToken,
      expiresAt,
      refreshToken,
    };
  }
);

authenticator.use(microsoftStrategy);

export async function getUserEmail(request: Request) {
  const cookieSession = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );
  const userId = cookieSession.get(userIdKey);

  return userId ?? null;
}

export async function getSessionId(request: Request) {
  const cookieSession = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );
  return cookieSession.get(sessionIdKey);
}

export async function getAccessToken(request: Request) {
  const sessionId = await getSessionId(request);
  if (!sessionId) return null;

  const dbSession = await getDBSession(sessionId);
  return dbSession?.accessToken ?? null;
}

export async function getTokenExpiration(request: Request) {
  const sessionId = await getSessionId(request);
  if (!sessionId) return null;

  const dbSession = await getDBSession(sessionId);
  return dbSession?.expiresAt ?? null;
}

export async function isTokenExpired(request: Request) {
  const expiresAt = await getTokenExpiration(request);
  if (!expiresAt) return true;

  // Add a 5-minute buffer to refresh tokens before they actually expire
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
  return Date.now() >= expiresAt.getTime() - bufferTime;
}

export async function getRefreshToken(request: Request) {
  const sessionId = await getSessionId(request);
  if (!sessionId) return null;

  const dbSession = await getDBSession(sessionId);
  return dbSession?.refreshToken ?? null;
}

export async function refreshAccessToken(request: Request) {
  const refreshToken = await getRefreshToken(request);
  if (!refreshToken) return null;

  try {
    const newTokens = await microsoftStrategy.refreshToken(refreshToken);
    const newAccessToken = newTokens.accessToken();
    const newExpiresAt = newTokens.accessTokenExpiresAt();
    const newRefreshToken = newTokens.hasRefreshToken()
      ? newTokens.refreshToken()
      : refreshToken;

    const sessionId = await getSessionId(request);
    if (!sessionId) return null;

    // Update database session with new tokens
    await updateDBSession(sessionId, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    });

    return {
      accessToken: newAccessToken,
      expiresAt: newExpiresAt?.getTime(),
      refreshToken: newRefreshToken,
    };
  } catch (error) {
    console.error("Failed to refresh access token:", error);
    return null;
  }
}

export async function getValidAccessToken(request: Request) {
  const accessToken = await getAccessToken(request);
  if (!accessToken) return null;

  const isExpired = await isTokenExpired(request);
  if (isExpired) {
    // Try to refresh the token if refresh token is available
    const refreshToken = await getRefreshToken(request);
    if (refreshToken) {
      const refreshResult = await refreshAccessToken(request);
      if (refreshResult) {
        return refreshResult.accessToken;
      }
    }
    // If no refresh token or refresh failed, return null
    console.log("Access token expired and no refresh token available");
    return null;
  }

  return accessToken;
}

export async function getValidAccessTokenWithSession(request: Request) {
  const accessToken = await getAccessToken(request);
  if (!accessToken) return { accessToken: null, session: null };

  const isExpired = await isTokenExpired(request);
  if (isExpired) {
    // Try to refresh the token if refresh token is available
    const refreshToken = await getRefreshToken(request);
    if (refreshToken) {
      const refreshResult = await refreshAccessToken(request);
      if (refreshResult) {
        return {
          accessToken: refreshResult.accessToken,
          session: null, // No cookie session update needed
        };
      }
    }
    // If no refresh token or refresh failed, return null
    console.log("Access token expired and no refresh token available");
    return { accessToken: null, session: null };
  }

  return { accessToken, session: null };
}

export async function getTokenStatus(request: Request) {
  const accessToken = await getAccessToken(request);
  const expiresAt = await getTokenExpiration(request);
  const refreshToken = await getRefreshToken(request);
  const isExpired = await isTokenExpired(request);

  return {
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    expiresAt: expiresAt?.toISOString(),
    isExpired,
    timeUntilExpiry: expiresAt ? expiresAt.getTime() - Date.now() : null,
    canAutoRefresh: !!refreshToken,
    needsReauth: isExpired && !refreshToken,
  };
}

export async function requireUser(request: Request) {
  const userEmail = await getUserEmail(request);

  if (!userEmail) {
    throw logout({ request });
  }

  const user = await prisma.user.findUnique({
    where: {
      email: userEmail,
    },
  });

  if (!user) {
    throw logout({ request });
  }

  return user;
}

export async function logout({ request }: { request: Request }) {
  let session = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );

  // Clean up database session
  const sessionId = session.get(sessionIdKey);
  if (sessionId) {
    try {
      await deleteDBSession(sessionId);
    } catch (error) {
      console.error("Failed to delete database session:", error);
    }
  }

  return redirect("/", {
    headers: { "Set-Cookie": await authSessionStorage.destroySession(session) },
  });
}
