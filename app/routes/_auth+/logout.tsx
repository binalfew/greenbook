import { redirect } from "react-router";
import { authSessionStorage } from "~/lib/session.server";
import type { Route } from "./+types/logout";

export async function loader() {
  return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  let session = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );
  return redirect("/", {
    headers: { "Set-Cookie": await authSessionStorage.destroySession(session) },
  });
}
