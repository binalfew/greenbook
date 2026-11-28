import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "../app/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter });

// Unique permissions by resource+action for upsert
const UNIQUE_PERMISSIONS = [
  { resource: "user", action: "read", module: "system", description: "Read user data" },
  { resource: "user", action: "update", module: "system", description: "Update user data" },
  { resource: "user", action: "create", module: "system", description: "Create users" },
  { resource: "user", action: "delete", module: "system", description: "Delete users" },
  { resource: "role", action: "read", module: "system", description: "Read roles" },
  { resource: "settings", action: "read", module: "system", description: "Read system settings" },
  { resource: "settings", action: "write", module: "system", description: "Write system settings" },
  { resource: "feature-flag", action: "read", module: "system", description: "Read feature flags" },
  { resource: "feature-flag", action: "write", module: "system", description: "Manage feature flags" },
  { resource: "reference-data", action: "read", module: "data", description: "Read reference data" },
  { resource: "audit-log", action: "read", module: "audit", description: "Read audit logs" },
  { resource: "sso", action: "read", module: "auth", description: "Read SSO configurations" },
  { resource: "sso", action: "write", module: "auth", description: "Manage SSO configurations" },
  { resource: "sso", action: "delete", module: "auth", description: "Delete SSO configurations" },
  // Directory — focal authors submissions, manager reviews
  { resource: "organization", action: "read", module: "directory", description: "Read organizations" },
  { resource: "organization", action: "write", module: "directory", description: "Create or edit organizations (global admin only)" },
  { resource: "organization", action: "delete", module: "directory", description: "Delete organizations (global admin only)" },
  { resource: "person", action: "read", module: "directory", description: "Read people" },
  { resource: "person", action: "write", module: "directory", description: "Create or edit people (via approval)" },
  { resource: "person", action: "delete", module: "directory", description: "Delete people (via approval)" },
  { resource: "position", action: "read", module: "directory", description: "Read positions" },
  { resource: "position", action: "write", module: "directory", description: "Create or edit positions (global admin only)" },
  { resource: "position", action: "delete", module: "directory", description: "Delete positions (global admin only)" },
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

/**
 * The whole seed. It EMPTIES THE DATABASE FIRST: every table is truncated,
 * then the baseline is written again — statuses, the system tenant,
 * permissions, roles, feature flags, the global admin and the shared
 * reference data. Tenants, users, people, units, positions, change requests,
 * sessions and the audit log made since the last run are gone afterwards.
 */
export async function runSeed() {
  console.log("🌱 Starting seeding...");

  // Read first, so a missing value stops the seed before it writes anything.
  const admin = adminAccountFromEnv();

  console.log("Emptying the database...");
  await emptyDatabase();

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

  // The system tenant, the global admin's home. It is recognised by its
  // `system` slug, which the app does not let anyone change.
  console.log("Creating the system tenant...");
  const tenant = await prisma.tenant.create({
    data: {
      name: "System",
      slug: "system",
      email: "info@africanunion.org",
      phone: "+251 11 551 7700",
      city: "",
      state: "",
      address: "",
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
  //
  // Roles are now defined ONCE platform-wide (tenantId = null). There are
  // exactly four:
  //   admin   (GLOBAL) — platform admin; manages tenants, settings, role defs
  //   focal   (TENANT) — submits changes to people and their assignments
  //                      for the user's home tenant
  //   manager (TENANT) — approves focal submissions for the user's home tenant
  //                      + handles user CRUD inside the tenant
  // Organizational units and positions are changed by `admin` only.
  //   user    (GLOBAL) — authenticated cross-tenant directory reader
  //
  // RoleScope.TENANT no longer means "owned by tenant X via Role.tenantId" —
  // it now means "permissions apply to the user's home tenant" (services
  // already scope writes by ctx.tenantId resolved from User.tenantId, so this
  // falls out for free).
  console.log("Creating default roles...");
  // Each canonical role uses findFirst + create/update because Prisma's
  // compound unique key `tenantId_name` doesn't accept `null` for tenantId.
  // The Role model still has `@@unique([tenantId, name])` so the underlying
  // DB constraint is honoured; we just can't address it via the compound
  // key from JS when one component is null.
  async function upsertGlobalRole(
    name: string,
    scope: "GLOBAL" | "TENANT",
    description: string,
  ): Promise<{ id: string }> {
    const existing = await prisma.role.findFirst({
      where: { tenantId: null, name },
      select: { id: true },
    });
    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { scope, description },
      });
      return existing;
    }
    return prisma.role.create({
      data: { tenantId: null, name, scope, description },
      select: { id: true },
    });
  }

  const adminRole = await upsertGlobalRole(
    "admin",
    "GLOBAL",
    "Platform administrator — full access across all tenants",
  );
  const userRole = await upsertGlobalRole(
    "user",
    "GLOBAL",
    "Authenticated cross-tenant directory reader",
  );
  const focalRole = await upsertGlobalRole(
    "focal",
    "TENANT",
    "Submits changes to people and their assignments for the user's home tenant",
  );
  const managerRole = await upsertGlobalRole(
    "manager",
    "TENANT",
    "Approves focal submissions, edits people and their assignments, and manages users within the user's home tenant",
  );

  // Assign permissions via RolePermission
  console.log("Assigning permissions to roles...");

  // User role: read own + update own user data; cross-tenant directory reads
  // are always permitted at the public layer, but the `user` role still needs
  // baseline self-access for the in-app dashboard.
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

  // Admin role: all permissions (platform-wide).
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: perm.id, access: "any" },
    });
  }

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
    // No write or delete on organizations and positions: the structure of
    // the directory is kept by the global admin alone.
    { resource: "person", action: "write" },
    { resource: "person", action: "delete" },
    { resource: "position-assignment", action: "write" },
    { resource: "position-assignment", action: "delete" },
    { resource: "directory-change", action: "read-all" },
    { resource: "directory-change", action: "approve" },
    { resource: "directory-change", action: "reject" },
    // User CRUD inside the manager's home tenant — this is the slot that
    // used to belong to "tenant admin" before the role consolidation. Role
    // / permission definitions stay platform-admin-only (managers get
    // role:read so the user-roles picker can populate).
    { resource: "user", action: "read" },
    { resource: "user", action: "create" },
    { resource: "user", action: "update" },
    { resource: "user", action: "delete" },
    { resource: "role", action: "read" },
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

  console.log("Seeding default feature flags...");
  await seedFeatureFlags();

  // The global admin, whose home is the system tenant: the only account the
  // seed creates.
  console.log("Creating admin user...");
  await prisma.user.create({
    data: {
      email: admin.email,
      firstName: "Admin",
      lastName: "User",
      tenantId: tenant.id,
      userStatusId: activeStatus.id,
      userRoles: { create: { roleId: adminRole.id } },
      password: { create: { hash: await hash(admin.password, 10) } },
    },
  });

  // Seed the shared reference data: titles, org types, position types,
  // regions, member states. One set, read by every tenant, so a tenant
  // created later needs nothing seeded for it.
  console.log("Seeding shared reference data...");
  await seedTitles();
  await seedDirectoryReference();

  console.log("✅ Seeding completed!");
  console.log(`🔑 Global admin: ${admin.email} (password from SEED_ADMIN_PASSWORD)`);
}

/**
 * The global admin's email and password, from SEED_ADMIN_EMAIL and
 * SEED_ADMIN_PASSWORD. The seed creates no account with a built-in password.
 */
function adminAccountFromEnv(): { email: string; password: string } {
  const email = process.env["SEED_ADMIN_EMAIL"]?.trim().toLowerCase();
  const password = process.env["SEED_ADMIN_PASSWORD"];
  if (!email || !password) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running the seed: they are the global admin's login.",
    );
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters long.");
  }
  return { email, password };
}

/**
 * The flags the app checks.
 *
 * Tenant-scoped flags are off for a tenant until it is on `enabledForTenants`
 * (see evaluateFlag in feature-flags.server.ts); their `enabled` boolean is
 * ignored. Tenants get on that list when they are created.
 */
async function seedFeatureFlags() {
  const DEFAULT_FLAGS = [
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
}

/** True when no row of the shared table holds this code yet, deleted rows included. */
async function isNewCode(holder: Promise<{ id: string } | null>) {
  return (await holder) === null;
}

/** Shared titles. */
async function seedTitles() {
  const titles = [
    { code: "MR", name: "Mr." },
    { code: "MRS", name: "Mrs." },
    { code: "MS", name: "Ms." },
    { code: "DR", name: "Dr." },
    { code: "PROF", name: "Prof." },
    { code: "HE", name: "H.E." },
    { code: "AMB", name: "Amb." },
  ];
  for (const [i, t] of titles.entries()) {
    if (await isNewCode(prisma.title.findFirst({ where: { code: t.code }, select: { id: true } }))) {
      await prisma.title.create({ data: { sortOrder: i, ...t } });
    }
  }
}

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

// Directory reference data — organization types, position types, regional
// groups, and member states. One set shared by every tenant.
async function seedDirectoryReference() {
  for (const [i, t] of ORGANIZATION_TYPES.entries()) {
    const held = prisma.organizationType.findFirst({ where: { code: t.code }, select: { id: true } });
    if (await isNewCode(held)) {
      await prisma.organizationType.create({
        data: { sortOrder: i, ...t, description: t.description ?? null },
      });
    }
  }
  for (const t of POSITION_TYPES) {
    const held = prisma.positionType.findFirst({ where: { code: t.code }, select: { id: true } });
    if (await isNewCode(held)) await prisma.positionType.create({ data: t });
  }

  // Regions + member states (55 AU members)
  const regionByCode: Record<string, string> = {};
  for (const r of REGIONAL_GROUPS) {
    const row =
      (await prisma.regionalGroup.findFirst({ where: { code: r.code }, select: { id: true } })) ??
      (await prisma.regionalGroup.create({ data: { code: r.code, name: r.name } }));
    regionByCode[r.code] = row.id;
  }
  for (const m of MEMBER_STATES) {
    const existing = await prisma.memberState.findFirst({
      where: { abbreviation: m.abbr },
      select: { id: true },
    });
    if (existing) continue;
    const regionId = regionByCode[m.regionCode];
    await prisma.memberState.create({
      data: {
        fullName: m.name,
        abbreviation: m.abbr,
        dateJoined: new Date(m.dateJoined),
        isActive: m.active ?? true,
        ...(regionId && { regions: { create: { regionalGroupId: regionId } } }),
      },
    });
  }
}

/**
 * Truncate every table of the schema in one statement, so the seed always
 * starts from nothing. `_prisma_migrations` is kept, for a database that is
 * ever moved to `prisma migrate`.
 */
async function emptyDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

// Run only as a script (`npx tsx prisma/seed.ts`), not when a test imports `runSeed`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .catch((e) => {
      console.error("❌ Error during seeding:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
