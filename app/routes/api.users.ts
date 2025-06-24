import { data } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getUsers } from "~/lib/graph.server";
import type { Route } from "./+types/api.users";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request); // Require authentication
  const users = await getUsers();
  return data(users);
}
