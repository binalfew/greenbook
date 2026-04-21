import { useRouteLoaderData } from "react-router";
import { type loader as rootLoader } from "~/root";

function isUser(user: any): user is Awaited<ReturnType<typeof rootLoader>>["data"]["user"] {
  return user && typeof user === "object" && typeof user.id === "string";
}

export function useOptionalUser() {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  if (!data || !isUser(data.user)) {
    return undefined;
  }
  return data.user;
}

export function useUser() {
  const maybeUser = useOptionalUser();
  if (!maybeUser) {
    throw new Error(
      "No user found in root loader, but user is required by useUser. If user is optional, try useOptionalUser instead.",
    );
  }

  return maybeUser;
}

type Action = "create" | "read" | "update" | "delete" | "execute";

type Resource = "user" | "role" | "permission" | "tenant" | "participant" | "audit" | "impersonate";

type Access = "own" | "any" | "own,any" | "any,own";

export type PermissionString = `${Action}:${Resource}` | `${Action}:${Resource}:${Access}`;

export function parsePermissionString(permissionString: PermissionString) {
  const [action, resource, access] = permissionString.split(":") as [
    Action,
    Resource,
    Access | undefined,
  ];

  return {
    action,
    resource,
    access: access ? (access.split(",") as Array<Access>) : undefined,
  };
}

type UserWithRoles = {
  userRoles: Array<{
    role: {
      name: string;
      rolePermissions: Array<{
        access: string;
        permission: {
          resource: string;
          action: string;
        };
      }>;
    };
  }>;
};

export function userHasPermission(user: UserWithRoles | null, permission: PermissionString) {
  if (!user) return false;
  const { action, resource, access } = parsePermissionString(permission);
  return user.userRoles.some((userRole) =>
    userRole.role.rolePermissions.some(
      (rp) =>
        rp.permission.resource === resource &&
        rp.permission.action === action &&
        (!access || access.includes(rp.access as Access)),
    ),
  );
}

export function userHasRole(user: UserWithRoles | null, role: string) {
  if (!user) return false;
  return user.userRoles.some((ur) => ur.role.name === role);
}

export function userHasRoles(user: UserWithRoles | null, roles: string[]) {
  if (!user) return false;
  return roles.some((role) => userHasRole(user, role));
}
