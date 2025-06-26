import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function addDefaultSchedules() {
  try {
    console.log("🌱 Adding default sync schedules...");

    // Default selective sync schedule (daily)
    await prisma.syncSchedule.upsert({
      where: { name: "Daily Selective Sync" },
      update: {
        description: "Daily selective sync for users and hierarchy",
        syncType: "selective",
        cronExpression: "0 2 * * *", // 2 AM daily
        syncOptions: {
          users: true,
          referenceData: false,
          hierarchy: true,
          linkReferences: true,
        },
      },
      create: {
        name: "Daily Selective Sync",
        description: "Daily selective sync for users and hierarchy",
        syncType: "selective",
        cronExpression: "0 2 * * *", // 2 AM daily
        syncOptions: {
          users: true,
          referenceData: false,
          hierarchy: true,
          linkReferences: true,
        },
      },
    });

    // Full sync schedule (weekly)
    await prisma.syncSchedule.upsert({
      where: { name: "Weekly Full Sync" },
      update: {
        description: "Weekly full sync including reference data",
        syncType: "selective",
        cronExpression: "0 3 * * 0", // 3 AM on Sundays
        syncOptions: {
          users: true,
          referenceData: true,
          hierarchy: true,
          linkReferences: true,
        },
      },
      create: {
        name: "Weekly Full Sync",
        description: "Weekly full sync including reference data",
        syncType: "selective",
        cronExpression: "0 3 * * 0", // 3 AM on Sundays
        syncOptions: {
          users: true,
          referenceData: true,
          hierarchy: true,
          linkReferences: true,
        },
      },
    });

    // Incremental sync schedule (hourly during business hours)
    await prisma.syncSchedule.upsert({
      where: { name: "Hourly Incremental Sync" },
      update: {
        description: "Hourly incremental sync during business hours",
        syncType: "incremental",
        cronExpression: "0 9-17 * * 1-5", // 9 AM to 5 PM, Monday to Friday
        syncOptions: {
          users: true,
          hierarchy: true,
        },
      },
      create: {
        name: "Hourly Incremental Sync",
        description: "Hourly incremental sync during business hours",
        syncType: "incremental",
        cronExpression: "0 9-17 * * 1-5", // 9 AM to 5 PM, Monday to Friday
        syncOptions: {
          users: true,
          hierarchy: true,
        },
      },
    });

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

    console.log("✅ Default schedules created:");
    schedules.forEach((schedule) => {
      console.log(`   - ${schedule.name} (${schedule.syncType})`);
    });
  } catch (error) {
    console.error("❌ Error creating schedules:", error);
  } finally {
    await prisma.$disconnect();
  }
}

addDefaultSchedules();
