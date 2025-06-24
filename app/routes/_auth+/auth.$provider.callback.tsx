import { data, redirect } from "react-router";
import {
  authenticator,
  sessionIdKey,
  userIdKey,
  type ProviderUser,
} from "~/lib/auth.server";
import prisma from "~/lib/prisma";
import { authSessionStorage, createDBSession } from "~/lib/session.server";
import { generateId } from "~/lib/utils";
import type { Route } from "./+types/auth.$provider.callback";

export async function loader({ request, params }: Route.LoaderArgs) {
  const provider = params.provider;

  let user = await authenticator
    .authenticate(provider, request)
    .catch((error) => {
      if (error instanceof Error) {
        return data({
          error: error.message,
        });
      }

      throw error;
    });

  if ("error" in user) {
    return data({ error: user.error });
  }

  const providerUser = user as ProviderUser;

  const existingUser = await prisma.user.findUnique({
    where: {
      email: providerUser.email,
    },
  });

  if (!existingUser) {
    await prisma.user.create({
      data: {
        email: providerUser.email,
        name: providerUser.name,
        role: "USER",
      },
    });
  }

  // Create a unique session ID
  const sessionId = generateId();

  // Store tokens in database
  await createDBSession(sessionId, providerUser.email, {
    accessToken: providerUser.accessToken,
    refreshToken: providerUser.refreshToken,
    expiresAt: providerUser.expiresAt
      ? new Date(providerUser.expiresAt)
      : undefined,
  });

  // Store minimal data in cookie session
  let session = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );

  session.set(userIdKey, providerUser.email);
  session.set(sessionIdKey, sessionId);

  return redirect("/", {
    headers: {
      "Set-Cookie": await authSessionStorage.commitSession(session),
    },
  });
}
