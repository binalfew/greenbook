import { useParams } from "react-router";

/**
 * Where the directory search lives for the current page: `/<slug>/directory`
 * inside a workspace, the site root otherwise. Its pages are
 * `<base>/` (the search) and `<base>/people/<id>` (a profile).
 */
export function useDirectoryBase(): string {
  const { tenant } = useParams();
  return tenant ? `/${tenant}/directory` : "";
}
