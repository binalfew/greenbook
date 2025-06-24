#!/usr/bin/env node

/**
 * Test script for sync cancellation functionality
 * Run with: node scripts/test-cancel-sync.js
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testCancelSync() {
  console.log("🧪 Testing Sync Cancellation...\n");

  try {
    // 1. Check for any running syncs
    console.log("1. Checking for running syncs...");
    const runningSyncs = await prisma.syncLog.findMany({
      where: { status: "running" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (runningSyncs.length > 0) {
      console.log(`   Found ${runningSyncs.length} running sync(s):`);
      runningSyncs.forEach((sync) => {
        console.log(
          `   - ID: ${sync.id}, Type: ${sync.syncType}, Started: ${sync.startedAt}`
        );
      });
    } else {
      console.log("   No running syncs found");
    }

    // 2. Check recent sync history
    console.log("\n2. Recent sync history:");
    const recentSyncs = await prisma.syncLog.findMany({
      where: { syncType: "full_sync" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (recentSyncs.length > 0) {
      console.log(`   Found ${recentSyncs.length} recent full sync(s):`);
      recentSyncs.forEach((sync) => {
        const duration = sync.completedAt
          ? Math.round(
              (new Date(sync.completedAt) - new Date(sync.startedAt)) / 1000
            )
          : "Running";
        console.log(`   - ID: ${sync.id}`);
        console.log(`     Status: ${sync.status}`);
        console.log(`     Started: ${sync.startedAt}`);
        console.log(`     Duration: ${duration}s`);
        console.log(
          `     Processed: ${sync.recordsProcessed}, Failed: ${sync.recordsFailed}`
        );
        if (sync.message) {
          console.log(`     Message: ${sync.message}`);
        }
        console.log("");
      });
    } else {
      console.log("   No recent syncs found");
    }

    // 3. Check for cancelled syncs specifically
    console.log("3. Cancelled syncs:");
    const cancelledSyncs = await prisma.syncLog.findMany({
      where: { status: "cancelled" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (cancelledSyncs.length > 0) {
      console.log(`   Found ${cancelledSyncs.length} cancelled sync(s):`);
      cancelledSyncs.forEach((sync) => {
        console.log(
          `   - ID: ${sync.id}, Type: ${sync.syncType}, Message: ${
            sync.message || "No message"
          }`
        );
      });
    } else {
      console.log("   No cancelled syncs found");
    }

    // 4. Database statistics
    console.log("\n4. Database statistics:");
    const stats = await prisma.syncLog.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    console.log("   Sync status distribution:");
    stats.forEach((stat) => {
      console.log(`   - ${stat.status}: ${stat._count.status}`);
    });
  } catch (error) {
    console.error("❌ Error during test:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testCancelSync();
