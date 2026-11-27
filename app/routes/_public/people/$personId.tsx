import { data } from "react-router";
import { PublicDetailNotFound } from "~/components/public/not-found";
import { PersonProfile } from "~/components/public/person-profile";
import { requireUserId } from "~/utils/auth/auth.server";
import { DIRECTORY_CACHE_HEADER, loadDirectoryProfile } from "~/utils/public-directory.server";
import type { Route } from "./+types/$personId";

// Auth-gated profile — the directory serves AU staff + member states only,
// so responses are per-session and never shared on an edge cache.

export async function loader({ request, params }: Route.LoaderArgs) {
  // Login required to view any profile.
  await requireUserId(request);
  const person = await loadDirectoryProfile(params.personId);
  return data({ person }, { headers: { "Cache-Control": DIRECTORY_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": DIRECTORY_CACHE_HEADER };
}

export default function PublicPersonDetail({ loaderData }: Route.ComponentProps) {
  return <PersonProfile person={loaderData.person} />;
}

export function ErrorBoundary() {
  return <PublicDetailNotFound kind="person" />;
}
