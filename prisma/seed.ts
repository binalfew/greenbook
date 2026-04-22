import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { PrismaClient } from "../app/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter });

const SEED_PERMISSIONS = [
  { resource: "user", action: "read", module: "system", description: "Read user data", access: "own" },
  { resource: "user", action: "update", module: "system", description: "Update own user data", access: "own" },
  { resource: "user", action: "read", module: "system", description: "Read all user data", access: "any" },
  { resource: "user", action: "create", module: "system", description: "Create users", access: "any" },
  { resource: "user", action: "update", module: "system", description: "Update any user", access: "any" },
  { resource: "user", action: "delete", module: "system", description: "Delete users", access: "any" },
  { resource: "role", action: "read", module: "system", description: "Read roles", access: "any" },
  { resource: "role", action: "create", module: "system", description: "Create roles", access: "any" },
  { resource: "role", action: "update", module: "system", description: "Update roles", access: "any" },
  { resource: "role", action: "delete", module: "system", description: "Delete roles", access: "any" },
  { resource: "permission", action: "read", module: "system", description: "Read permissions", access: "any" },
  { resource: "permission", action: "create", module: "system", description: "Create permissions", access: "any" },
  { resource: "permission", action: "update", module: "system", description: "Update permissions", access: "any" },
  { resource: "permission", action: "delete", module: "system", description: "Delete permissions", access: "any" },
];

// Unique permissions by resource+action for upsert
const UNIQUE_PERMISSIONS = [
  { resource: "user", action: "read", module: "system", description: "Read user data" },
  { resource: "user", action: "update", module: "system", description: "Update user data" },
  { resource: "user", action: "create", module: "system", description: "Create users" },
  { resource: "user", action: "delete", module: "system", description: "Delete users" },
  { resource: "role", action: "read", module: "system", description: "Read roles" },
  { resource: "role", action: "create", module: "system", description: "Create roles" },
  { resource: "role", action: "update", module: "system", description: "Update roles" },
  { resource: "role", action: "delete", module: "system", description: "Delete roles" },
  { resource: "permission", action: "read", module: "system", description: "Read permissions" },
  { resource: "permission", action: "create", module: "system", description: "Create permissions" },
  { resource: "permission", action: "update", module: "system", description: "Update permissions" },
  { resource: "permission", action: "delete", module: "system", description: "Delete permissions" },
  { resource: "tenant", action: "read", module: "system", description: "Read tenants" },
  { resource: "tenant", action: "create", module: "system", description: "Create tenants" },
  { resource: "tenant", action: "update", module: "system", description: "Update tenants" },
  { resource: "tenant", action: "delete", module: "system", description: "Delete tenants" },
  { resource: "settings", action: "read", module: "system", description: "Read system settings" },
  { resource: "settings", action: "write", module: "system", description: "Write system settings" },
  { resource: "feature-flag", action: "read", module: "system", description: "Read feature flags" },
  { resource: "feature-flag", action: "write", module: "system", description: "Manage feature flags" },
  { resource: "notification", action: "read", module: "events", description: "Read notifications" },
  { resource: "notification", action: "write", module: "events", description: "Manage notifications" },
  { resource: "notification", action: "delete", module: "events", description: "Delete notifications" },
  { resource: "webhook", action: "read", module: "events", description: "Read webhook subscriptions" },
  { resource: "webhook", action: "write", module: "events", description: "Manage webhook subscriptions" },
  { resource: "webhook", action: "delete", module: "events", description: "Delete webhook subscriptions" },
  { resource: "saved-view", action: "read", module: "data", description: "Read saved views" },
  { resource: "saved-view", action: "write", module: "data", description: "Manage saved views" },
  { resource: "saved-view", action: "delete", module: "data", description: "Delete saved views" },
  { resource: "reference-data", action: "read", module: "data", description: "Read reference data" },
  { resource: "reference-data", action: "write", module: "data", description: "Manage reference data" },
  { resource: "reference-data", action: "delete", module: "data", description: "Delete reference data" },
  { resource: "audit-log", action: "read", module: "audit", description: "Read audit logs" },
  { resource: "sso", action: "read", module: "auth", description: "Read SSO configurations" },
  { resource: "sso", action: "write", module: "auth", description: "Manage SSO configurations" },
  { resource: "sso", action: "delete", module: "auth", description: "Delete SSO configurations" },
  { resource: "two-factor", action: "read", module: "auth", description: "Read 2FA enforcement policy" },
  { resource: "two-factor", action: "update", module: "auth", description: "Update 2FA enforcement policy" },
  // Directory — focal authors submissions, manager reviews
  { resource: "organization", action: "read", module: "directory", description: "Read organizations" },
  { resource: "organization", action: "write", module: "directory", description: "Create or edit organizations (via approval)" },
  { resource: "organization", action: "delete", module: "directory", description: "Delete organizations (via approval)" },
  { resource: "person", action: "read", module: "directory", description: "Read people" },
  { resource: "person", action: "write", module: "directory", description: "Create or edit people (via approval)" },
  { resource: "person", action: "delete", module: "directory", description: "Delete people (via approval)" },
  { resource: "position", action: "read", module: "directory", description: "Read positions" },
  { resource: "position", action: "write", module: "directory", description: "Create or edit positions (via approval)" },
  { resource: "position", action: "delete", module: "directory", description: "Delete positions (via approval)" },
  { resource: "position-assignment", action: "read", module: "directory", description: "Read position assignments" },
  { resource: "position-assignment", action: "write", module: "directory", description: "Create or edit position assignments (via approval)" },
  { resource: "position-assignment", action: "delete", module: "directory", description: "Delete position assignments (via approval)" },
  { resource: "directory-change", action: "submit", module: "directory", description: "Submit directory change requests" },
  { resource: "directory-change", action: "withdraw-own", module: "directory", description: "Withdraw own pending submissions" },
  { resource: "directory-change", action: "read-own", module: "directory", description: "Read own submissions" },
  { resource: "directory-change", action: "read-all", module: "directory", description: "Read every submission in the tenant" },
  { resource: "directory-change", action: "approve", module: "directory", description: "Approve directory change requests" },
  { resource: "directory-change", action: "reject", module: "directory", description: "Reject directory change requests" },
];

async function main() {
  console.log("🌱 Starting seeding...");

  // Create default user statuses
  console.log("Creating default user statuses...");
  const activeStatus = await prisma.userStatus.upsert({
    where: { code: "ACTIVE" },
    update: {},
    create: {
      name: "Active",
      code: "ACTIVE",
      description: "Active user status",
      isActive: true,
      order: 1,
    },
  });

  await prisma.userStatus.upsert({
    where: { code: "INACTIVE" },
    update: {},
    create: {
      name: "Inactive",
      code: "INACTIVE",
      description: "Inactive user status",
      isActive: false,
      order: 2,
    },
  });

  await prisma.userStatus.upsert({
    where: { code: "PENDING" },
    update: {},
    create: {
      name: "Pending",
      code: "PENDING",
      description: "Pending verification user status",
      isActive: false,
      order: 3,
    },
  });

  // Remove legacy @example.com demo accounts so re-seeding an existing DB
  // converges to the africanunion.org demo users without duplicates. User
  // cascade handles sessions/passwords/roles; ChangeRequest references
  // (submittedBy is required, reviewedBy is nullable) need explicit handling
  // since their relations have no onDelete Cascade.
  const legacyUserIds = await prisma.user
    .findMany({
      where: { email: { endsWith: "@example.com" } },
      select: { id: true },
    })
    .then((rows) => rows.map((r) => r.id));
  if (legacyUserIds.length > 0) {
    await prisma.changeRequest.deleteMany({
      where: { submittedById: { in: legacyUserIds } },
    });
    await prisma.changeRequest.updateMany({
      where: { reviewedById: { in: legacyUserIds } },
      data: { reviewedById: null },
    });
    const { count } = await prisma.user.deleteMany({
      where: { id: { in: legacyUserIds } },
    });
    console.log(`Removed ${count} legacy @example.com user(s).`);
  }

  // Resolve or create the AU Commission tenant (slug kept as `system` so
  // route prefixes and fallbacks stay stable across template + fork).
  console.log("Resolving default tenant...");
  const existingTenant = await prisma.tenant.findFirst({
    where: { slug: "system", deletedAt: null },
  });
  const tenant =
    existingTenant ??
    (await prisma.tenant.create({
      data: {
        name: "African Union Commission",
        slug: "system",
        email: "info@africanunion.org",
        phone: "+251 11 551 7700",
        city: "Addis Ababa",
        state: "Addis Ababa",
        address: "Roosevelt Street (Old Airport Area), P.O. Box 3243, Addis Ababa, Ethiopia",
        brandTheme: "auc",
      },
    }));
  // Keep name/contact/brand in sync for forks that already ran an older seed.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      name: "African Union Commission",
      email: "info@africanunion.org",
      phone: "+251 11 551 7700",
      city: "Addis Ababa",
      state: "Addis Ababa",
      address: "Roosevelt Street (Old Airport Area), P.O. Box 3243, Addis Ababa, Ethiopia",
      brandTheme: "auc",
    },
  });

  // Create permissions (unique by resource+action)
  console.log("Creating default permissions...");
  for (const perm of UNIQUE_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: { description: perm.description, module: perm.module },
      create: perm,
    });
  }

  // Create roles
  console.log("Creating default roles...");
  const userRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "user" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "user",
      scope: "TENANT",
      description: "Default user role with basic permissions",
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "admin" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "admin",
      scope: "GLOBAL",
      description: "Administrator role with full permissions",
    },
  });

  // Assign permissions via RolePermission
  console.log("Assigning permissions to roles...");

  // User role: read own + update own user data
  await prisma.rolePermission.deleteMany({ where: { roleId: userRole.id } });
  for (const { resource, action, access } of [
    { resource: "user", action: "read", access: "own" },
    { resource: "user", action: "update", access: "own" },
  ]) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: userRole.id, permissionId: perm.id, access },
      });
    }
  }

  // Admin role: all permissions
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: perm.id, access: "any" },
    });
  }

  // Directory roles — focal (authors submissions) + manager (reviewer)
  console.log("Seeding directory roles...");
  const focalRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "focal" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "focal",
      scope: "TENANT",
      description: "Authors directory submissions; cannot approve",
    },
  });
  const managerRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "manager" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "manager",
      scope: "TENANT",
      description: "Reviews + approves directory submissions; can self-approve direct edits",
    },
  });

  const focalPerms = [
    { resource: "organization", action: "read" },
    { resource: "person", action: "read" },
    { resource: "position", action: "read" },
    { resource: "position-assignment", action: "read" },
    { resource: "directory-change", action: "submit" },
    { resource: "directory-change", action: "withdraw-own" },
    { resource: "directory-change", action: "read-own" },
  ];
  const managerPerms = [
    ...focalPerms,
    { resource: "organization", action: "write" },
    { resource: "organization", action: "delete" },
    { resource: "person", action: "write" },
    { resource: "person", action: "delete" },
    { resource: "position", action: "write" },
    { resource: "position", action: "delete" },
    { resource: "position-assignment", action: "write" },
    { resource: "position-assignment", action: "delete" },
    { resource: "directory-change", action: "read-all" },
    { resource: "directory-change", action: "approve" },
    { resource: "directory-change", action: "reject" },
  ];

  await prisma.rolePermission.deleteMany({ where: { roleId: focalRole.id } });
  for (const { resource, action } of focalPerms) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: focalRole.id, permissionId: perm.id, access: "any" },
      });
    }
  }

  await prisma.rolePermission.deleteMany({ where: { roleId: managerRole.id } });
  for (const { resource, action } of managerPerms) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: managerRole.id, permissionId: perm.id, access: "any" },
      });
    }
  }

  // Create admin user
  console.log("Creating admin user...");
  const adminPassword = await hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@africanunion.org" },
    update: {},
    create: {
      email: "admin@africanunion.org",
      firstName: "Admin",
      lastName: "User",
      tenantId: tenant.id,
      userStatusId: activeStatus.id,
      userRoles: { create: { roleId: adminRole.id } },
      password: { create: { hash: adminPassword } },
    },
  });

  // Create regular user
  console.log("Creating regular user...");
  const userPassword = await hash("user123", 10);
  await prisma.user.upsert({
    where: { email: "user@africanunion.org" },
    update: {},
    create: {
      email: "user@africanunion.org",
      firstName: "Regular",
      lastName: "User",
      tenantId: tenant.id,
      userStatusId: activeStatus.id,
      userRoles: { create: { roleId: userRole.id } },
      password: { create: { hash: userPassword } },
    },
  });

  // Seed default feature flags
  console.log("Seeding default feature flags...");
  const DEFAULT_FLAGS = [
    {
      key: "FF_TWO_FACTOR",
      scope: "global",
      enabled: true,
      description: "Enable 2FA enrolment and enforcement",
    },
    {
      key: "FF_IMPERSONATION",
      scope: "global",
      enabled: true,
      description: "Allow global admins to impersonate tenant users",
    },
    {
      key: "FF_WEBHOOKS",
      scope: "tenant",
      enabled: false,
      description: "Allow tenant to register webhook subscriptions",
    },
    {
      key: "FF_NOTIFICATIONS",
      scope: "tenant",
      enabled: true,
      description: "In-app notifications bell and list",
    },
    {
      key: "FF_PWA",
      scope: "global",
      enabled: false,
      description: "Progressive web app installable shell",
    },
    {
      key: "FF_I18N",
      scope: "global",
      enabled: false,
      description: "Multi-language UI",
    },
    {
      key: "FF_AUDIT_EXPORT",
      scope: "tenant",
      enabled: false,
      description: "Export audit log (CSV/JSON)",
    },
    {
      key: "FF_DIRECTORY",
      scope: "tenant",
      enabled: true,
      description: "AU Directory (Organizations, People, Positions, Assignments) admin surface",
    },
    {
      key: "FF_PUBLIC_DIRECTORY",
      scope: "tenant",
      enabled: true,
      description:
        "Opt-in: tenant contributes approved records to the cross-tenant public directory at /public/directory",
    },
  ];
  for (const f of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: {},
      create: f,
    });
  }
  await prisma.featureFlag.deleteMany({
    where: { key: { notIn: DEFAULT_FLAGS.map((f) => f.key) } },
  });

  // Tenant-scoped flags with `enabled: true` are off by default until a
  // tenant is explicitly added to `enabledForTenants` (see evaluateFlag in
  // feature-flags.server.ts). Opt the system tenant in so the demo users
  // can actually reach the admin directory + public directory out of the
  // box.
  await prisma.featureFlag.update({
    where: { key: "FF_DIRECTORY" },
    data: { enabledForTenants: { set: [tenant.id] } },
  });
  await prisma.featureFlag.update({
    where: { key: "FF_PUBLIC_DIRECTORY" },
    data: { enabledForTenants: { set: [tenant.id] } },
  });

  // Wipe directory + reference data for the tenant before reseeding so the
  // DB is deterministic. User-created records, stale change requests, and
  // old org-tree nodes are all cleared — the rebuild that follows is the
  // single source of truth for the demo state.
  console.log("Wiping directory + reference data for tenant...");
  await wipeDirectoryData(tenant.id);

  // Seed default reference data for the system tenant.
  console.log("Seeding default reference data...");
  await seedReferenceData(tenant.id);

  // Seed directory baseline for the system tenant: org types, position
  // types, regions, member states, starter org tree, demo focal/manager users.
  console.log("Seeding directory baseline...");
  await seedDirectory(tenant.id, { activeStatusId: activeStatus.id, focalRoleId: focalRole.id, managerRoleId: managerRole.id });

  console.log("✅ Seeding completed!");
  console.log("🔑 Users created:");
  console.log("   Admin:        admin@africanunion.org / admin123");
  console.log("   User:         user@africanunion.org / user123");
  console.log("   Focal person: focal@africanunion.org / focal123");
  console.log("   Manager:      manager@africanunion.org / manager123");
}

/**
 * Wipe directory + reference data for a tenant. Order respects every FK
 * so Postgres never complains mid-flight:
 *   - ChangeRequest first (it references User rows with no cascade).
 *   - PositionAssignment before Person (personId is onDelete: Restrict).
 *   - Position before Organization (self-ref SetNull is tolerant, but
 *     organizations own positions so we delete children first).
 *   - Organization tree: null every parentId before deleteMany so the
 *     self-referential Restrict FK doesn't block.
 *   - Then types + reference data — MemberState deletions cascade the
 *     join rows in MemberStateRegion.
 * Tenant, users, roles, permissions, feature flags, settings are all
 * preserved; the demo auth surface is unaffected.
 */
async function wipeDirectoryData(tenantId: string) {
  await prisma.changeRequest.deleteMany({ where: { tenantId } });
  await prisma.positionAssignment.deleteMany({ where: { tenantId } });
  await prisma.position.deleteMany({ where: { tenantId } });
  await prisma.person.deleteMany({ where: { tenantId } });
  await prisma.organization.updateMany({ where: { tenantId }, data: { parentId: null } });
  await prisma.organization.deleteMany({ where: { tenantId } });
  await prisma.organizationType.deleteMany({ where: { tenantId } });
  await prisma.positionType.deleteMany({ where: { tenantId } });
  await prisma.memberState.deleteMany({ where: { tenantId } });
  await prisma.regionalGroup.deleteMany({ where: { tenantId } });
  await prisma.title.deleteMany({ where: { tenantId } });
  await prisma.language.deleteMany({ where: { tenantId } });
}

/**
 * Populate reference data for a newly-created tenant. Safe to re-run — each
 * row upserts on `(tenantId, code)`.
 */
async function seedReferenceData(tenantId: string) {
  const titles = [
    { code: "MR", name: "Mr." },
    { code: "MRS", name: "Mrs." },
    { code: "MS", name: "Ms." },
    { code: "DR", name: "Dr." },
    { code: "PROF", name: "Prof." },
  ];
  for (const [i, t] of titles.entries()) {
    await prisma.title.upsert({
      where: { tenantId_code: { tenantId, code: t.code } },
      update: {},
      create: { tenantId, sortOrder: i, ...t },
    });
  }

  const languages = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "de", name: "German", nativeName: "Deutsch" },
    { code: "es", name: "Spanish", nativeName: "Español" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "am", name: "Amharic", nativeName: "አማርኛ" },
    { code: "zh", name: "Chinese", nativeName: "中文" },
  ];
  for (const [i, l] of languages.entries()) {
    await prisma.language.upsert({
      where: { tenantId_code: { tenantId, code: l.code } },
      update: {},
      create: { tenantId, sortOrder: i, ...l },
    });
  }
}

/** Exported for tenant-setup.server.ts to copy defaults to new tenants. */
export { seedReferenceData };

// ─── Directory baseline ──────────────────────────────────────────────────

const ORGANIZATION_TYPES = [
  { code: "ROOT", name: "Root", level: 0, description: "Top-level tenant root (e.g., AU)" },
  { code: "MAIN_ORGAN", name: "Main Organ", level: 1, description: "Principal organs of the AU" },
  { code: "DEPARTMENT", name: "Department", level: 2 },
  { code: "OFFICE", name: "Office", level: 3 },
  { code: "UNIT", name: "Unit", level: 4 },
];

const POSITION_TYPES = [
  { code: "CHAIRPERSON", name: "Chairperson", hierarchyLevel: 0 },
  { code: "DEPUTY_CHAIRPERSON", name: "Deputy Chairperson", hierarchyLevel: 1 },
  { code: "COMMISSIONER", name: "Commissioner", hierarchyLevel: 2 },
  { code: "DIRECTOR", name: "Director", hierarchyLevel: 3 },
  { code: "DEPUTY_DIRECTOR", name: "Deputy Director", hierarchyLevel: 4 },
  { code: "HEAD_OF_UNIT", name: "Head of Unit", hierarchyLevel: 5 },
  { code: "SENIOR_OFFICER", name: "Senior Officer", hierarchyLevel: 6 },
  { code: "OFFICER", name: "Officer", hierarchyLevel: 7 },
  { code: "ADMIN_STAFF", name: "Administrative Staff", hierarchyLevel: 8 },
];

const REGIONAL_GROUPS = [
  { code: "CA", name: "Central Africa" },
  { code: "EA", name: "Eastern Africa" },
  { code: "NA", name: "Northern Africa" },
  { code: "SA", name: "Southern Africa" },
  { code: "WA", name: "Western Africa" },
];

// AU Member States — 55 countries with region assignments.
// Source: African Union (member states at accession / charter).
const MEMBER_STATES: Array<{
  abbr: string;
  name: string;
  dateJoined: string;
  regionCode: string;
  active?: boolean;
}> = [
  { abbr: "DZA", name: "Algeria", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "AGO", name: "Angola", dateJoined: "1975-02-11", regionCode: "CA" },
  { abbr: "BEN", name: "Benin", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "BWA", name: "Botswana", dateJoined: "1966-10-31", regionCode: "SA" },
  { abbr: "BFA", name: "Burkina Faso", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "BDI", name: "Burundi", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "CPV", name: "Cabo Verde", dateJoined: "1975-07-18", regionCode: "WA" },
  { abbr: "CMR", name: "Cameroon", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "CAF", name: "Central African Republic", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "TCD", name: "Chad", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "COM", name: "Comoros", dateJoined: "1975-07-18", regionCode: "EA" },
  { abbr: "COG", name: "Congo", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "COD", name: "Democratic Republic of the Congo", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "CIV", name: "Côte d'Ivoire", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "DJI", name: "Djibouti", dateJoined: "1977-06-27", regionCode: "EA" },
  { abbr: "EGY", name: "Egypt", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "GNQ", name: "Equatorial Guinea", dateJoined: "1968-10-12", regionCode: "CA" },
  { abbr: "ERI", name: "Eritrea", dateJoined: "1993-05-24", regionCode: "EA" },
  { abbr: "SWZ", name: "Eswatini", dateJoined: "1968-09-06", regionCode: "SA" },
  { abbr: "ETH", name: "Ethiopia", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "GAB", name: "Gabon", dateJoined: "1963-05-25", regionCode: "CA" },
  { abbr: "GMB", name: "Gambia", dateJoined: "1965-02-18", regionCode: "WA" },
  { abbr: "GHA", name: "Ghana", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "GIN", name: "Guinea", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "GNB", name: "Guinea-Bissau", dateJoined: "1974-09-19", regionCode: "WA" },
  { abbr: "KEN", name: "Kenya", dateJoined: "1963-12-13", regionCode: "EA" },
  { abbr: "LSO", name: "Lesotho", dateJoined: "1966-10-31", regionCode: "SA" },
  { abbr: "LBR", name: "Liberia", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "LBY", name: "Libya", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "MDG", name: "Madagascar", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "MWI", name: "Malawi", dateJoined: "1964-07-13", regionCode: "SA" },
  { abbr: "MLI", name: "Mali", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "MRT", name: "Mauritania", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "MUS", name: "Mauritius", dateJoined: "1968-08-01", regionCode: "EA" },
  { abbr: "MAR", name: "Morocco", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "MOZ", name: "Mozambique", dateJoined: "1975-07-18", regionCode: "SA" },
  { abbr: "NAM", name: "Namibia", dateJoined: "1990-06-01", regionCode: "SA" },
  { abbr: "NER", name: "Niger", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "NGA", name: "Nigeria", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "RWA", name: "Rwanda", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "STP", name: "São Tomé and Príncipe", dateJoined: "1975-07-18", regionCode: "CA" },
  { abbr: "SEN", name: "Senegal", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "SYC", name: "Seychelles", dateJoined: "1976-06-29", regionCode: "EA" },
  { abbr: "SLE", name: "Sierra Leone", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "SOM", name: "Somalia", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "ZAF", name: "South Africa", dateJoined: "1994-06-06", regionCode: "SA" },
  { abbr: "SSD", name: "South Sudan", dateJoined: "2011-07-28", regionCode: "EA" },
  { abbr: "SDN", name: "Sudan", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "TZA", name: "Tanzania", dateJoined: "1964-04-26", regionCode: "EA" },
  { abbr: "TGO", name: "Togo", dateJoined: "1963-05-25", regionCode: "WA" },
  { abbr: "TUN", name: "Tunisia", dateJoined: "1963-05-25", regionCode: "NA" },
  { abbr: "UGA", name: "Uganda", dateJoined: "1963-05-25", regionCode: "EA" },
  { abbr: "ZMB", name: "Zambia", dateJoined: "1964-10-24", regionCode: "SA" },
  { abbr: "ZWE", name: "Zimbabwe", dateJoined: "1980-06-01", regionCode: "SA" },
  { abbr: "ESH", name: "Sahrawi Arab Democratic Republic", dateJoined: "1982-02-22", regionCode: "NA" },
];

async function seedDirectory(
  tenantId: string,
  { activeStatusId, focalRoleId, managerRoleId }: {
    activeStatusId: string;
    focalRoleId: string;
    managerRoleId: string;
  },
) {
  for (const [i, t] of ORGANIZATION_TYPES.entries()) {
    await prisma.organizationType.upsert({
      where: { tenantId_code: { tenantId, code: t.code } },
      update: { name: t.name, level: t.level, description: t.description ?? null, sortOrder: i },
      create: { tenantId, sortOrder: i, ...t, description: t.description ?? null },
    });
  }
  for (const t of POSITION_TYPES) {
    await prisma.positionType.upsert({
      where: { tenantId_code: { tenantId, code: t.code } },
      update: { name: t.name, hierarchyLevel: t.hierarchyLevel },
      create: { tenantId, ...t },
    });
  }

  // Regions + member states (55 AU members)
  const regionByCode: Record<string, string> = {};
  for (const r of REGIONAL_GROUPS) {
    const row = await prisma.regionalGroup.upsert({
      where: { tenantId_code: { tenantId, code: r.code } },
      update: { name: r.name },
      create: { tenantId, code: r.code, name: r.name },
    });
    regionByCode[r.code] = row.id;
  }
  for (const m of MEMBER_STATES) {
    const state = await prisma.memberState.upsert({
      where: { tenantId_abbreviation: { tenantId, abbreviation: m.abbr } },
      update: {
        fullName: m.name,
        dateJoined: new Date(m.dateJoined),
        isActive: m.active ?? true,
      },
      create: {
        tenantId,
        fullName: m.name,
        abbreviation: m.abbr,
        dateJoined: new Date(m.dateJoined),
        isActive: m.active ?? true,
      },
    });
    const regionId = regionByCode[m.regionCode];
    if (regionId) {
      const existing = await prisma.memberStateRegion.findUnique({
        where: {
          memberStateId_regionalGroupId: {
            memberStateId: state.id,
            regionalGroupId: regionId,
          },
        },
      });
      if (!existing) {
        await prisma.memberStateRegion.create({
          data: { memberStateId: state.id, regionalGroupId: regionId },
        });
      }
    }
  }

  // Starter org tree: AU (root) → Commission (main organ) → 3 sample
  // departments / offices. Safe to re-run; keyed on (tenantId, name).
  const rootType = await prisma.organizationType.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: "ROOT" } },
  });
  const mainOrganType = await prisma.organizationType.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: "MAIN_ORGAN" } },
  });
  const deptType = await prisma.organizationType.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: "DEPARTMENT" } },
  });
  const officeType = await prisma.organizationType.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: "OFFICE" } },
  });

  const au = await upsertOrg(tenantId, {
    name: "African Union",
    acronym: "AU",
    typeId: rootType.id,
    parentId: null,
    sortOrder: 0,
  });
  const commission = await upsertOrg(tenantId, {
    name: "African Union Commission",
    acronym: "AUC",
    typeId: mainOrganType.id,
    parentId: au.id,
    sortOrder: 0,
  });
  await upsertOrg(tenantId, {
    name: "Office of the Chairperson",
    acronym: "OOC",
    typeId: officeType.id,
    parentId: commission.id,
    sortOrder: 0,
  });
  await upsertOrg(tenantId, {
    name: "Office of the Deputy Chairperson",
    acronym: "ODC",
    typeId: officeType.id,
    parentId: commission.id,
    sortOrder: 1,
  });
  await upsertOrg(tenantId, {
    name: "Department of Political Affairs, Peace and Security",
    acronym: "PAPS",
    typeId: deptType.id,
    parentId: commission.id,
    sortOrder: 2,
  });
  await upsertOrg(tenantId, {
    name: "Department of Economic Development, Trade, Tourism, Industry and Mining",
    acronym: "ETTIM",
    typeId: deptType.id,
    parentId: commission.id,
    sortOrder: 3,
  });

  // Demo users: focal person + manager. Idempotent on email.
  const focalPassword = await hash("focal123", 10);
  await prisma.user.upsert({
    where: { email: "focal@africanunion.org" },
    update: {},
    create: {
      email: "focal@africanunion.org",
      firstName: "Fola",
      lastName: "Adeyemi",
      tenantId,
      userStatusId: activeStatusId,
      userRoles: { create: { roleId: focalRoleId } },
      password: { create: { hash: focalPassword } },
    },
  });
  const managerPassword = await hash("manager123", 10);
  await prisma.user.upsert({
    where: { email: "manager@africanunion.org" },
    update: {},
    create: {
      email: "manager@africanunion.org",
      firstName: "Marta",
      lastName: "Okonkwo",
      tenantId,
      userStatusId: activeStatusId,
      userRoles: { create: { roleId: managerRoleId } },
      password: { create: { hash: managerPassword } },
    },
  });

  // Seed realistic AUC positions + people + current assignments so the
  // demo has a browsable directory out of the box.
  await seedPositionsPeopleAssignments(tenantId);
}

// ─── Positions + People + Assignments ────────────────────────────────────
//
// Fictional but plausible AUC leadership so the demo directory feels alive.
// Positions are created first with reporting chains resolved from the title
// map; people are created with member-state + language links; a current
// assignment ties each person to their post. All three pass are idempotent:
// re-seeding simply no-ops or updates in place.

type SeedPosition = {
  orgAcronym: string;
  title: string;
  typeCode: string;
  reportsToTitle: string | null;
  sortOrder: number;
  description?: string;
};

const SEED_POSITIONS: SeedPosition[] = [
  {
    orgAcronym: "OOC",
    title: "Chairperson of the African Union Commission",
    typeCode: "CHAIRPERSON",
    reportsToTitle: null,
    sortOrder: 0,
    description:
      "Chief Executive Officer of the African Union Commission; legal representative of the AU.",
  },
  {
    orgAcronym: "OOC",
    title: "Chief of Staff, Office of the Chairperson",
    typeCode: "SENIOR_OFFICER",
    reportsToTitle: "Chairperson of the African Union Commission",
    sortOrder: 1,
  },
  {
    orgAcronym: "ODC",
    title: "Deputy Chairperson of the African Union Commission",
    typeCode: "DEPUTY_CHAIRPERSON",
    reportsToTitle: "Chairperson of the African Union Commission",
    sortOrder: 0,
    description:
      "Assists the Chairperson; oversees administrative, financial, and budgetary affairs of the Commission.",
  },
  {
    orgAcronym: "ODC",
    title: "Chief of Staff, Office of the Deputy Chairperson",
    typeCode: "SENIOR_OFFICER",
    reportsToTitle: "Deputy Chairperson of the African Union Commission",
    sortOrder: 1,
  },
  {
    orgAcronym: "PAPS",
    title: "Commissioner for Political Affairs, Peace and Security",
    typeCode: "COMMISSIONER",
    reportsToTitle: "Chairperson of the African Union Commission",
    sortOrder: 0,
  },
  {
    orgAcronym: "PAPS",
    title: "Director of Political Affairs",
    typeCode: "DIRECTOR",
    reportsToTitle: "Commissioner for Political Affairs, Peace and Security",
    sortOrder: 1,
  },
  {
    orgAcronym: "PAPS",
    title: "Director of Peace and Security",
    typeCode: "DIRECTOR",
    reportsToTitle: "Commissioner for Political Affairs, Peace and Security",
    sortOrder: 2,
  },
  {
    orgAcronym: "ETTIM",
    title: "Commissioner for Economic Development, Trade, Tourism, Industry and Mining",
    typeCode: "COMMISSIONER",
    reportsToTitle: "Chairperson of the African Union Commission",
    sortOrder: 0,
  },
  {
    orgAcronym: "ETTIM",
    title: "Director of Trade and Industry",
    typeCode: "DIRECTOR",
    reportsToTitle:
      "Commissioner for Economic Development, Trade, Tourism, Industry and Mining",
    sortOrder: 1,
  },
  {
    orgAcronym: "ETTIM",
    title: "Director of Economic Development",
    typeCode: "DIRECTOR",
    reportsToTitle:
      "Commissioner for Economic Development, Trade, Tourism, Industry and Mining",
    sortOrder: 2,
  },
];

type SeedPerson = {
  positionTitle: string;
  honorific: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  bio?: string;
  memberStateAbbr: string;
  languages: string[];
  showEmail: boolean;
  showPhone: boolean;
  startDate: string; // ISO
};

const SEED_PEOPLE: SeedPerson[] = [
  {
    positionTitle: "Chairperson of the African Union Commission",
    honorific: "H.E.",
    firstName: "Fatima",
    lastName: "N'Diaye",
    email: "chairperson@africanunion.org",
    bio: "Career diplomat and former foreign minister. Chairperson of the African Union Commission since 2024.",
    memberStateAbbr: "SEN",
    languages: ["fr", "en", "ar"],
    showEmail: true,
    showPhone: false,
    startDate: "2024-02-18",
  },
  {
    positionTitle: "Chief of Staff, Office of the Chairperson",
    honorific: "Mr.",
    firstName: "Samuel",
    lastName: "Tekle",
    email: "samuel.tekle@africanunion.org",
    memberStateAbbr: "ERI",
    languages: ["en", "fr"],
    showEmail: false,
    showPhone: false,
    startDate: "2024-03-01",
  },
  {
    positionTitle: "Deputy Chairperson of the African Union Commission",
    honorific: "H.E.",
    firstName: "Kwame",
    lastName: "Asante",
    email: "deputy.chairperson@africanunion.org",
    bio: "Economist and former minister of finance; oversees the administrative and financial operations of the Commission.",
    memberStateAbbr: "GHA",
    languages: ["en", "fr"],
    showEmail: true,
    showPhone: false,
    startDate: "2024-02-18",
  },
  {
    positionTitle: "Chief of Staff, Office of the Deputy Chairperson",
    honorific: "Ms.",
    firstName: "Grace",
    lastName: "Mutesi",
    email: "grace.mutesi@africanunion.org",
    memberStateAbbr: "RWA",
    languages: ["en", "fr"],
    showEmail: false,
    showPhone: false,
    startDate: "2024-03-01",
  },
  {
    positionTitle: "Commissioner for Political Affairs, Peace and Security",
    honorific: "Amb.",
    firstName: "Tesfaye",
    lastName: "Desta",
    email: "paps.commissioner@africanunion.org",
    bio: "Former permanent representative to the United Nations with two decades of experience in continental security affairs.",
    memberStateAbbr: "ETH",
    languages: ["en", "am", "ar"],
    showEmail: true,
    showPhone: false,
    startDate: "2024-03-15",
  },
  {
    positionTitle: "Director of Political Affairs",
    honorific: "Mr.",
    firstName: "Ibrahim",
    lastName: "Keita",
    email: "ibrahim.keita@africanunion.org",
    memberStateAbbr: "MLI",
    languages: ["fr", "en"],
    showEmail: false,
    showPhone: false,
    startDate: "2023-06-01",
  },
  {
    positionTitle: "Director of Peace and Security",
    honorific: "Ms.",
    firstName: "Nadia",
    lastName: "Ben Ahmed",
    email: "nadia.benahmed@africanunion.org",
    memberStateAbbr: "TUN",
    languages: ["ar", "fr", "en"],
    showEmail: false,
    showPhone: false,
    startDate: "2022-09-12",
  },
  {
    positionTitle: "Commissioner for Economic Development, Trade, Tourism, Industry and Mining",
    honorific: "Dr.",
    firstName: "Amina",
    lastName: "Oumar",
    email: "ettim.commissioner@africanunion.org",
    bio: "PhD in development economics; led national trade policy reforms before joining the Commission.",
    memberStateAbbr: "TCD",
    languages: ["fr", "ar", "en"],
    showEmail: true,
    showPhone: false,
    startDate: "2024-03-15",
  },
  {
    positionTitle: "Director of Trade and Industry",
    honorific: "Mr.",
    firstName: "Chukwu",
    lastName: "Okafor",
    email: "chukwu.okafor@africanunion.org",
    memberStateAbbr: "NGA",
    languages: ["en"],
    showEmail: false,
    showPhone: false,
    startDate: "2023-02-01",
  },
  {
    positionTitle: "Director of Economic Development",
    honorific: "Dr.",
    firstName: "Rose",
    lastName: "Mwangi",
    email: "rose.mwangi@africanunion.org",
    memberStateAbbr: "KEN",
    languages: ["en", "fr"],
    showEmail: false,
    showPhone: false,
    startDate: "2023-02-01",
  },
];

async function seedPositionsPeopleAssignments(tenantId: string) {
  // Resolve lookups: org + position type by code, member state by abbreviation.
  const orgs = await prisma.organization.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, acronym: true },
  });
  const orgByAcronym = new Map(
    orgs.filter((o) => o.acronym !== null).map((o) => [o.acronym as string, o.id]),
  );

  const posTypes = await prisma.positionType.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, code: true },
  });
  const typeByCode = new Map(posTypes.map((t) => [t.code, t.id]));

  const memberStates = await prisma.memberState.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, abbreviation: true },
  });
  const memberStateByAbbr = new Map(memberStates.map((m) => [m.abbreviation, m.id]));

  // Pass 1: create/update positions without reportsToId. Natural key: (tenantId, orgId, title).
  const positionIdByTitle = new Map<string, string>();
  for (const p of SEED_POSITIONS) {
    const organizationId = orgByAcronym.get(p.orgAcronym);
    const typeId = typeByCode.get(p.typeCode);
    if (!organizationId || !typeId) continue;

    const existing = await prisma.position.findFirst({
      where: { tenantId, organizationId, title: p.title, deletedAt: null },
      select: { id: true },
    });
    const row = existing
      ? await prisma.position.update({
          where: { id: existing.id },
          data: {
            typeId,
            description: p.description ?? null,
            sortOrder: p.sortOrder,
            isActive: true,
          },
        })
      : await prisma.position.create({
          data: {
            tenantId,
            organizationId,
            typeId,
            title: p.title,
            description: p.description ?? null,
            sortOrder: p.sortOrder,
            isActive: true,
          },
        });
    positionIdByTitle.set(p.title, row.id);
  }

  // Pass 2: wire the reporting chain.
  for (const p of SEED_POSITIONS) {
    const selfId = positionIdByTitle.get(p.title);
    if (!selfId) continue;
    const reportsToId = p.reportsToTitle ? positionIdByTitle.get(p.reportsToTitle) ?? null : null;
    await prisma.position.update({
      where: { id: selfId },
      data: { reportsToId },
    });
  }

  // Pass 3: people, keyed on (tenantId, firstName, lastName) since email is optional.
  const personIdByPositionTitle = new Map<string, string>();
  for (const person of SEED_PEOPLE) {
    const memberStateId = memberStateByAbbr.get(person.memberStateAbbr) ?? null;
    const existing = await prisma.person.findFirst({
      where: {
        tenantId,
        firstName: person.firstName,
        lastName: person.lastName,
        deletedAt: null,
      },
      select: { id: true },
    });
    const row = existing
      ? await prisma.person.update({
          where: { id: existing.id },
          data: {
            honorific: person.honorific,
            email: person.email ?? null,
            phone: person.phone ?? null,
            bio: person.bio ?? null,
            memberStateId,
            languages: person.languages,
            showEmail: person.showEmail,
            showPhone: person.showPhone,
          },
        })
      : await prisma.person.create({
          data: {
            tenantId,
            firstName: person.firstName,
            lastName: person.lastName,
            honorific: person.honorific,
            email: person.email ?? null,
            phone: person.phone ?? null,
            bio: person.bio ?? null,
            memberStateId,
            languages: person.languages,
            showEmail: person.showEmail,
            showPhone: person.showPhone,
          },
        });
    personIdByPositionTitle.set(person.positionTitle, row.id);
  }

  // Pass 4: assignments — one current assignment per (position, person) pair.
  for (const person of SEED_PEOPLE) {
    const positionId = positionIdByTitle.get(person.positionTitle);
    const personId = personIdByPositionTitle.get(person.positionTitle);
    if (!positionId || !personId) continue;

    const existing = await prisma.positionAssignment.findFirst({
      where: { tenantId, positionId, personId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.positionAssignment.update({
        where: { id: existing.id },
        data: {
          startDate: new Date(person.startDate),
          endDate: null,
          isCurrent: true,
        },
      });
    } else {
      await prisma.positionAssignment.create({
        data: {
          tenantId,
          positionId,
          personId,
          startDate: new Date(person.startDate),
          isCurrent: true,
        },
      });
    }
  }
}

async function upsertOrg(
  tenantId: string,
  data: {
    name: string;
    acronym: string | null;
    typeId: string;
    parentId: string | null;
    sortOrder: number;
  },
) {
  const existing = await prisma.organization.findFirst({
    where: { tenantId, name: data.name, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: {
        acronym: data.acronym,
        typeId: data.typeId,
        parentId: data.parentId,
        sortOrder: data.sortOrder,
      },
    });
  }
  return prisma.organization.create({
    data: {
      tenantId,
      name: data.name,
      acronym: data.acronym,
      typeId: data.typeId,
      parentId: data.parentId,
      sortOrder: data.sortOrder,
    },
  });
}

export { seedDirectory };

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
