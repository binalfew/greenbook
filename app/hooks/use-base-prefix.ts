import { useParams } from "react-router";

/**
 * Returns the base URL prefix for the current context.
 * - Under `/$tenant/*` routes → `/<slug>`
 * - Under `/admin/*` routes  → `/admin`
 */
export function useBasePrefix(): string {
  const params = useParams();
  if (params.tenant) {
    return `/${params.tenant}`;
  }
  return "/admin";
}
