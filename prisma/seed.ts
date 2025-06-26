import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Clear existing data
  await prisma.staff.deleteMany();
  await prisma.department.deleteMany();
  await prisma.office.deleteMany();
  await prisma.jobTitle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.syncSchedule.deleteMany();

  console.log("🗑️  Cleared existing data");

  // Create Permissions
  const permissions = await Promise.all([
    prisma.permission.create({
      data: {
        action: "read",
        entity: "staff",
        access: "all",
        description: "Read all staff information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "staff",
        access: "own",
        description: "Write own staff information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "delete",
        entity: "staff",
        access: "all",
        description: "Delete staff records",
      },
    }),
    prisma.permission.create({
      data: {
        action: "read",
        entity: "department",
        access: "all",
        description: "Read department information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "department",
        access: "all",
        description: "Write department information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "read",
        entity: "office",
        access: "all",
        description: "Read office information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "office",
        access: "all",
        description: "Write office information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "manage",
        entity: "users",
        access: "all",
        description: "Manage all users",
      },
    }),
    prisma.permission.create({
      data: {
        action: "manage",
        entity: "roles",
        access: "all",
        description: "Manage roles and permissions",
      },
    }),
  ]);

  console.log("✅ Created permissions");

  // Create Roles
  const adminRole = await prisma.role.create({
    data: {
      name: "Administrator",
      description: "Full system access",
      permissions: {
        connect: permissions.map((p) => ({ id: p.id })),
      },
    },
  });

  const managerRole = await prisma.role.create({
    data: {
      name: "Manager",
      description: "Department management access",
      permissions: {
        connect: [
          { id: permissions[0].id }, // read staff all
          { id: permissions[1].id }, // write staff own
          { id: permissions[3].id }, // read department all
          { id: permissions[4].id }, // write department all
        ],
      },
    },
  });

  const staffRole = await prisma.role.create({
    data: {
      name: "Staff",
      description: "Basic staff access",
      permissions: {
        connect: [
          { id: permissions[0].id }, // read staff all
          { id: permissions[1].id }, // write staff own
        ],
      },
    },
  });

  console.log("✅ Created roles");

  // Create default sync schedules
  const schedules = await Promise.all([
    prisma.syncSchedule.create({
      data: {
        name: "Daily Incremental Sync",
        description: "Sync only changed users daily at 6 AM",
        syncType: "incremental",
        cronExpression: "0 6 * * *",
        syncOptions: {
          users: true,
          hierarchy: true,
          referenceData: false,
          linkReferences: false,
        },
        enabled: false, // Disabled by default
      },
    }),
    prisma.syncSchedule.create({
      data: {
        name: "Weekly Full Sync",
        description: "Complete sync of all data weekly on Sunday at 2 AM",
        syncType: "full",
        cronExpression: "0 2 * * 0",
        syncOptions: {
          users: true,
          hierarchy: true,
          referenceData: true,
          linkReferences: true,
        },
        enabled: false, // Disabled by default
      },
    }),
    prisma.syncSchedule.create({
      data: {
        name: "Hourly User Sync",
        description: "Sync user data every hour during business hours",
        syncType: "selective",
        cronExpression: "0 9-17 * * 1-5",
        syncOptions: {
          users: true,
          hierarchy: false,
          referenceData: false,
          linkReferences: false,
        },
        enabled: false, // Disabled by default
      },
    }),
  ]);

  console.log("✅ Created default sync schedules");

  console.log("🎉 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
