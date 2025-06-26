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
  await prisma.syncLog.deleteMany();
  await prisma.syncSchedule.deleteMany();

  console.log("🗑️  Cleared existing data");

  // Create default admin user
  const adminUser = await prisma.user.create({
    data: {
      email: "binalfewk@africanunion.org",
      name: "Binalfew",
      status: "ACTIVE",
      role: "admin",
    },
  });

  // Create admin privileges for the user
  await prisma.adminUser.create({
    data: {
      userId: adminUser.id,
    },
  });

  console.log("✅ Created admin user: binalfewk@africanunion.org");

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
