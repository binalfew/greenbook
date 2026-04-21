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

  // Create system tenant
  console.log("Creating system tenant...");
  const tenant = await prisma.tenant.upsert({
    where: { name: "System" },
    update: {},
    create: {
      name: "System",
      slug: "system",
      email: "system@template.local",
      phone: "+0000000000",
      city: "—",
      state: "—",
      address: "—",
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

  // Seed default reference data for the system tenant.
  console.log("Seeding default reference data...");
  await seedReferenceData(tenant.id);

  console.log("✅ Seeding completed!");
  console.log("🔑 Users created:");
  console.log("   Admin: admin@example.com / admin123");
  console.log("   User:  user@example.com / user123");
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

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
