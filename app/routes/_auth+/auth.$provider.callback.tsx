import { data, redirect } from "react-router";
import {
  accessTokenKey,
  authenticator,
  userIdKey,
  type ProviderUser,
} from "~/lib/auth.server";
import prisma from "~/lib/prisma";
import { authSessionStorage } from "~/lib/session.server";
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

  let session = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );

  session.set(userIdKey, providerUser.email);
  session.set(accessTokenKey, providerUser.accessToken);

  return redirect("/", {
    headers: {
      "Set-Cookie": await authSessionStorage.commitSession(session),
    },
  });
}
