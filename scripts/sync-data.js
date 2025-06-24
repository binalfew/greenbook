#!/usr/bin/env node

import { getSyncStatus, syncAllUsers } from "../app/lib/sync.server.js";

async function runSync() {
  console.log("🚀 Starting data synchronization...");

  try {
    const result = await syncAllUsers();

    console.log("✅ Sync completed!");
    console.log("📊 Results:");
    console.log(
      `   Users: ${result.usersSync.recordsProcessed} processed, ${result.usersSync.recordsFailed} failed`
    );
    console.log(
      `   Hierarchy: ${result.hierarchySync.recordsProcessed} processed, ${result.hierarchySync.recordsFailed} failed`
    );
    console.log(
      `   Photos: ${result.photosSync.processed} processed, ${result.photosSync.failed} failed`
    );

    // Get sync status
    const status = await getSyncStatus();
    console.log("\n📈 Database Status:");
    console.log(`   Total Staff: ${status.totalStaff}`);
    console.log(`   Staff with Photos: ${status.staffWithPhotos}`);
    console.log(`   Photo Coverage: ${status.photoCoverage.toFixed(1)}%`);
  } catch (error) {
    console.error("❌ Sync failed:", error);
    process.exit(1);
  }
}

runSync();
