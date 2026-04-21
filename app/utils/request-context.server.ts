import { extractClientIp } from "~/utils/auth/ip-utils.server";
import type { ServiceContext, TenantServiceContext } from "~/utils/types.server";

interface UserLike {
  id: string;
  tenantId?: string | null;
}

export function buildServiceContext(request: Request, user: UserLike): ServiceContext;
export function buildServiceContext(
  request: Request,
  user: UserLike,
  tenantId: string,
): TenantServiceContext;
export function buildServiceContext(
  request: Request,
  user: UserLike,
  tenantId?: string,
): ServiceContext {
  return {
    userId: user.id,
    tenantId: tenantId ?? user.tenantId ?? undefined,
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}
