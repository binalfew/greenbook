import { redirect } from "react-router";
import { authenticator } from "~/lib/auth.server";
import type { Route } from "./+types/auth.$provider";

export async function loader() {
  return redirect("/login");
}

export async function action({ request }: Route.ActionArgs) {
  return await authenticator.authenticate("microsoft", request);
}
