import { data } from "react-router";
import { requireUserId } from "./auth.server";
import { prisma } from "../db/db.server";
import { type PermissionString, parsePermissionString } from "./user";

export async function requireUserWithPermission(request: Request, permission: PermissionString) {
  const userId = await requireUserId(request);
  const permissionData = parsePermissionString(permission);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: {
      id: userId,
      userRoles: {
        some: {
          role: {
            rolePermissions: {
              some: {
                permission: {
                  resource: permissionData.resource,
                  action: permissionData.action,
                },
                ...(permissionData.access ? { access: { in: permissionData.access } } : {}),
              },
            },
          },
        },
      },
    },
  });
  if (!user) {
    throw data(
      {
        error: "Unauthorized",
        requiredPermission: permissionData,
        message: `Unauthorized: required permissions: ${permission}`,
      },
      { status: 403 },
    );
  }
  return user.id;
}

export async function requireUserWithRole(request: Request, name: string) {
  const userId = await requireUserId(request);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: {
      id: userId,
      userRoles: { some: { role: { name } } },
    },
  });
  if (!user) {
    throw data(
      {
        error: "Unauthorized",
        requiredRole: name,
        message: `Unauthorized: required role: ${name}`,
      },
      { status: 403 },
    );
  }
  return user.id;
}
