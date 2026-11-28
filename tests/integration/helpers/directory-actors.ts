import type { PrismaClient } from "../../../app/generated/prisma/client.js";
import { buildTenant, seedActiveUserStatus } from "../../factories";
import { createSessionCookie } from "./session";

// The people of the directory workflow, as the seed sets them up: a working
// tenant opted into the directory, the platform-wide `focal` and `manager`
// roles with their seeded permissions, and signed-in users holding them.

export type Actor = { id: string; cookie: string };

const ENTITIES = ["organization", "person", "position", "position-assignment"] as const;

export const FOCAL_PERMISSIONS: [string, string][] = [
  ...ENTITIES.map((entity): [string, string] => [entity, "read"]),
  ["directory-change", "submit"],
  ["directory-change", "read-own"],
  ["directory-change", "withdraw-own"],
];

export const MANAGER_PERMISSIONS: [string, string][] = [
  ...FOCAL_PERMISSIONS,
  // Organizations and positions are the global admin's: no write, no delete.
  ...(["person", "position-assignment"] as const).flatMap((entity): [string, string][] => [
    [entity, "write"],
    [entity, "delete"],
  ]),
  ["directory-change", "read-all"],
  ["directory-change", "approve"],
  ["directory-change", "reject"],
];

export async function grantPermissions(
  prisma: PrismaClient,
  roleId: string,
  permissions: [string, string][],
  module = "directory",
) {
  for (const [resource, action] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action, module },
      update: {},
    });
    await prisma.rolePermission.create({
      data: { roleId, permissionId: permission.id, access: "any" },
    });
  }
}

/** Opt a tenant into the directory, creating the flag when it is missing. */
export async function enableDirectory(prisma: PrismaClient, tenantId: string) {
  await prisma.featureFlag.upsert({
    where: { key: "FF_DIRECTORY" },
    create: { key: "FF_DIRECTORY", scope: "tenant", enabled: false, enabledForTenants: [tenantId] },
    update: { enabledForTenants: { push: tenantId } },
  });
}

export type DirectoryActors = Awaited<ReturnType<typeof seedDirectoryActors>>;

export async function seedDirectoryActors(
  prisma: PrismaClient,
  options: { slug?: string; enableDirectory?: boolean } = {},
) {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({
    data: buildTenant(options.slug ? { slug: options.slug } : undefined),
  });

  // Roles are stored platform-wide: no tenant, whatever their scope.
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  await grantPermissions(prisma, focalRole.id, FOCAL_PERMISSIONS);
  await grantPermissions(prisma, managerRole.id, MANAGER_PERMISSIONS);

  if (options.enableDirectory !== false) await enableDirectory(prisma, tenant.id);

  async function member(name: string, roleId: string, tenantId: string | null = tenant.id) {
    const created = await prisma.user.create({
      data: {
        email: `${name}-${tenant.id}@test.com`,
        firstName: name,
        lastName: "Tester",
        tenantId,
        userStatusId: status.id,
        userRoles: { create: { roleId } },
      },
    });
    return { id: created.id, cookie: await createSessionCookie(prisma, created.id) };
  }

  const orgType = await prisma.organizationType.create({
    data: { code: "ROOT", name: "Root", level: 0 },
  });

  return {
    tenant,
    tenantId: tenant.id,
    slug: tenant.slug,
    statusId: status.id,
    focalRole,
    managerRole,
    focal: await member("focal", focalRole.id),
    otherFocal: await member("other-focal", focalRole.id),
    manager: await member("manager", managerRole.id),
    secondManager: await member("second-manager", managerRole.id),
    orgTypeId: orgType.id,
    /** Add another signed-in user holding `roleId`, in this tenant unless told otherwise. */
    member,
  };
}

/**
 * The person editor's form for someone called "Test <name>". The duplicate
 * check is confirmed up front, so a save is never held back by its warning.
 */
export function personForm(name: string, extra: Record<string, string> = {}) {
  const local = name.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return {
    firstName: "Test",
    lastName: name,
    email: `${local}@people.test`,
    phone: "+251 11 000 0000",
    officeEmail: `${local}@office.test`,
    officePhone: "+251 11 000 0001",
    confirmDuplicates: "on",
    ...extra,
  };
}
