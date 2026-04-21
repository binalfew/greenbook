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
  { resource: "note", action: "read", module: "content", description: "Read notes" },
  { resource: "note", action: "write", module: "content", description: "Create and edit notes" },
  { resource: "note", action: "delete", module: "content", description: "Delete notes" },
  { resource: "two-factor", action: "read", module: "auth", description: "Read 2FA enforcement policy" },
  { resource: "two-factor", action: "update", module: "auth", description: "Update 2FA enforcement policy" },
  // Directory — focal_person authors submissions, manager reviews
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

  // Resolve or create the default tenant. Prefer a tenant that already
  // owns slug "system" (including forks that renamed the default), falling
  // back to creating a fresh "System" tenant on a clean database.
  console.log("Resolving default tenant...");
  const existingTenant = await prisma.tenant.findFirst({
    where: { slug: "system", deletedAt: null },
  });
  const tenant =
    existingTenant ??
    (await prisma.tenant.create({
      data: {
        name: "System",
        slug: "system",
        email: "system@template.local",
        phone: "+0000000000",
        city: "—",
        state: "—",
        address: "—",
      },
    }));

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

  // Directory roles — focal_person (authors submissions) + manager (reviewer)
  console.log("Seeding directory roles...");
  const focalPersonRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "focal_person" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "focal_person",
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

  const focalPersonPerms = [
    { resource: "organization", action: "read" },
    { resource: "person", action: "read" },
    { resource: "position", action: "read" },
    { resource: "position-assignment", action: "read" },
    { resource: "directory-change", action: "submit" },
    { resource: "directory-change", action: "withdraw-own" },
    { resource: "directory-change", action: "read-own" },
  ];
  const managerPerms = [
    ...focalPersonPerms,
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

  await prisma.rolePermission.deleteMany({ where: { roleId: focalPersonRole.id } });
  for (const { resource, action } of focalPersonPerms) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: focalPersonRole.id, permissionId: perm.id, access: "any" },
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
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
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
    where: { email: "user@example.com" },
    update: {},
    create: {
      email: "user@example.com",
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
      key: "FF_NOTES",
      scope: "tenant",
      enabled: true,
      description: "Notes demo entity — living documentation of every template pattern",
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

  // Seed default reference data for the system tenant.
  console.log("Seeding default reference data...");
  await seedReferenceData(tenant.id);

  // Seed directory baseline for the system tenant: org types, position
  // types, regions, member states, starter org tree, demo focal/manager users.
  console.log("Seeding directory baseline...");
  await seedDirectory(tenant.id, { activeStatusId: activeStatus.id, focalRoleId: focalPersonRole.id, managerRoleId: managerRole.id });

  console.log("✅ Seeding completed!");
  console.log("🔑 Users created:");
  console.log("   Admin:        admin@example.com / admin123");
  console.log("   User:         user@example.com / user123");
  console.log("   Focal person: focal@example.com / focal123");
  console.log("   Manager:      manager@example.com / manager123");
}

/**
 * Populate reference data for a newly-created tenant. Safe to re-run — each
 * row upserts on `(tenantId, code)`.
 */
async function seedReferenceData(tenantId: string) {
  const countries = [
    { code: "US", name: "United States", alpha3: "USA", numericCode: "840", phoneCode: "+1", flag: "🇺🇸" },
    { code: "GB", name: "United Kingdom", alpha3: "GBR", numericCode: "826", phoneCode: "+44", flag: "🇬🇧" },
    { code: "FR", name: "France", alpha3: "FRA", numericCode: "250", phoneCode: "+33", flag: "🇫🇷" },
    { code: "DE", name: "Germany", alpha3: "DEU", numericCode: "276", phoneCode: "+49", flag: "🇩🇪" },
    { code: "ET", name: "Ethiopia", alpha3: "ETH", numericCode: "231", phoneCode: "+251", flag: "🇪🇹" },
    { code: "CA", name: "Canada", alpha3: "CAN", numericCode: "124", phoneCode: "+1", flag: "🇨🇦" },
    { code: "JP", name: "Japan", alpha3: "JPN", numericCode: "392", phoneCode: "+81", flag: "🇯🇵" },
    { code: "AU", name: "Australia", alpha3: "AUS", numericCode: "036", phoneCode: "+61", flag: "🇦🇺" },
  ];
  for (const [i, c] of countries.entries()) {
    await prisma.country.upsert({
      where: { tenantId_code: { tenantId, code: c.code } },
      update: {},
      create: { tenantId, sortOrder: i, ...c },
    });
  }

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

  const currencies = [
    { code: "USD", name: "US Dollar", symbol: "$", decimalDigits: 2 },
    { code: "EUR", name: "Euro", symbol: "€", decimalDigits: 2 },
    { code: "GBP", name: "British Pound", symbol: "£", decimalDigits: 2 },
    { code: "JPY", name: "Japanese Yen", symbol: "¥", decimalDigits: 0 },
    { code: "ETB", name: "Ethiopian Birr", symbol: "Br", decimalDigits: 2 },
    { code: "CAD", name: "Canadian Dollar", symbol: "$", decimalDigits: 2 },
    { code: "AUD", name: "Australian Dollar", symbol: "$", decimalDigits: 2 },
  ];
  for (const [i, c] of currencies.entries()) {
    await prisma.currency.upsert({
      where: { tenantId_code: { tenantId, code: c.code } },
      update: {},
      create: { tenantId, sortOrder: i, ...c },
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
    where: { email: "focal@example.com" },
    update: {},
    create: {
      email: "focal@example.com",
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
    where: { email: "manager@example.com" },
    update: {},
    create: {
      email: "manager@example.com",
      firstName: "Marta",
      lastName: "Okonkwo",
      tenantId,
      userStatusId: activeStatusId,
      userRoles: { create: { roleId: managerRoleId } },
      password: { create: { hash: managerPassword } },
    },
  });
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
