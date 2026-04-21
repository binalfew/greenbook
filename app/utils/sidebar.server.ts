import * as cookie from "cookie";

const SIDEBAR_COOKIE = "sidebar_state";
const GROUPS_COOKIE = "sidebar_groups";

export function getSidebarState(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[SIDEBAR_COOKIE] : null;
  if (parsed === "false") return false;
  return true;
}

export function getSidebarGroupState(request: Request): Record<string, boolean> {
  const cookieHeader = request.headers.get("cookie");
  const raw = cookieHeader ? cookie.parse(cookieHeader)[GROUPS_COOKIE] : null;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
