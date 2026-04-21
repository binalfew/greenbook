export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

export const getClientIp = extractClientIp;

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent");
}
