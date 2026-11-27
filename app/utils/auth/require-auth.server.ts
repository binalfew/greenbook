import { data } from "react-router";
import { RoleScope } from "~/generated/prisma/client";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { requireUser } from "./session.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionResource = string;
export type PermissionAction = string;

export interface AuthRole {
  id: string;
  name: string;
  scope: RoleScope;
}

export interface AuthPermission {
  resource: PermissionResource;
  action: PermissionAction;
  access: string; // "own" | "any"
  roleScope: RoleScope;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  roles: AuthRole[];
  permissions: AuthPermission[];
}

// ---------------------------------------------------------------------------
// Request-scoped cache
// ---------------------------------------------------------------------------

const authCache = new WeakMap<Request, Promise<AuthUser>>();

async function loadAuthUser(request: Request): Promise<AuthUser> {
  const user = await requireUser(request);

  const roles: AuthRole[] = user.userRoles.map((ur) => ({
    id: ur.role.id,
    name: ur.role.name,
    scope: ur.role.scope,
  }));

  const permissions: AuthPermission[] = user.userRoles.flatMap((ur) =>
    ur.role.rolePermissions.map((rp) => ({
      resource: rp.permission.resource as PermissionResource,
      action: rp.permission.action as PermissionAction,
      access: rp.access,
      roleScope: ur.role.scope,
    })),
  );

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: user.tenantId,
    roles,
    permissions,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — caches per-request so DB is hit only once
// ---------------------------------------------------------------------------

export async function requireAuth(request: Request): Promise<AuthUser> {
  const existing = authCache.get(request);
  if (existing) return existing;
  const promise = loadAuthUser(request);
  authCache.set(request, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Permission / role helpers
// ---------------------------------------------------------------------------

export async function requirePermission(
  request: Request,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<AuthUser> {
  const user = await requireAuth(request);
  const has = user.permissions.some((p) => p.resource === resource && p.action === action);
  if (!has) {
    throw data(
      {
        error: "Forbidden",
        requiredPermission: { resource, action },
        message: `Missing permission: ${resource}:${action}`,
      },
      { status: 403 },
    );
  }
  return user;
}

export async function requireRole(request: Request, roleName: string): Promise<AuthUser> {
  const user = await requireAuth(request);
  if (!user.roles.some((r) => r.name === roleName)) {
    throw data({ error: "Forbidden", requiredRole: roleName }, { status: 403 });
  }
  return user;
}

export async function requireAnyRole(request: Request, roleNames: string[]): Promise<AuthUser> {
  const user = await requireAuth(request);
  if (!user.roles.some((r) => roleNames.includes(r.name))) {
    throw data({ error: "Forbidden", requiredAnyRole: roleNames }, { status: 403 });
  }
  return user;
}

export async function requireGlobalAdmin(request: Request): Promise<AuthUser> {
  const user = await requireAuth(request);
  const isGlobalAdmin = user.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");
  if (!isGlobalAdmin) {
    throw data({ error: "Forbidden", requiredRole: "GLOBAL admin" }, { status: 403 });
  }
  return user;
}

// ---------------------------------------------------------------------------
// Convenience predicates (non-throwing — for conditional UI rendering)
// ---------------------------------------------------------------------------

export function hasPermission(
  user: AuthUser,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  return user.permissions.some((p) => p.resource === resource && p.action === action);
}

export function hasRole(user: AuthUser, roleName: string): boolean {
  return user.roles.some((r) => r.name === roleName);
}

export interface ClientUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
}

/**
 * Project an AuthUser to the minimal shape safe to hand to the UI layer
 * (no permissions, no internal audit fields).
 */
export function toClientUser(user: AuthUser): ClientUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
  };
}
