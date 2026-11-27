import { csrf } from "~/utils/auth/csrf.server";

// Request builders and result readers for tests that call a route's loader or
// action directly. Paths are absolute (`/medical/directory/people`), so the
// first segment is the tenant the request acts on.

export type FormBody = Record<string, string | string[]> | [string, string][];

function toParams(body: FormBody): URLSearchParams {
  const params = new URLSearchParams();
  const entries = Array.isArray(body) ? body : Object.entries(body);
  for (const [key, value] of entries) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

export function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

/** A form POST with a valid CSRF token, as the browser would send it. */
export async function post(path: string, cookie: string | undefined, body: FormBody = {}) {
  const [token, csrfCookie] = await csrf.commitToken();
  const params = toParams(body);
  params.append("csrf", token);
  const cookies = [cookie, csrfCookie!.split(";")[0]].filter(Boolean).join("; ");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
    body: params.toString(),
  });
}

/** Route args for a loader or action. */
export function routeArgs(request: Request, params: Record<string, string> = {}) {
  return { request, params, context: {} } as never;
}

/** Run a loader/action and return what it returned or threw. */
export async function run<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (thrown) {
    // `data()` throws are plain objects; anything else is a real failure.
    if (thrown instanceof Response || isDataResult(thrown)) return thrown as Response;
    throw thrown;
  }
}

function isDataResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && "data" in value && "init" in value;
}

/** HTTP status of a returned/thrown Response or `data()` result (200 when unset). */
export function statusOf(result: unknown): number {
  if (result instanceof Response) return result.status;
  const init = (result as { init?: { status?: number } | null } | null)?.init;
  return init?.status ?? 200;
}

export function payloadOf<T>(result: unknown): T {
  return (result as { data: T }).data;
}

export function locationOf(result: unknown): string | null {
  return result instanceof Response ? result.headers.get("location") : null;
}
