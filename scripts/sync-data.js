#!/usr/bin/env node

import { getSyncStatus, syncAllUsers } from "../app/lib/sync.server.js";

async function runSync() {
  console.log("🚀 Starting data synchronization...");

  try {
    const result = await syncAllUsers();

    console.log("✅ Sync completed!");
    console.log("📊 Sync Results:");
    console.log(
      `   Users: ${result.usersSync.processed} processed, ${result.usersSync.failed} failed`
    );
    console.log(
      `   Reference Data: ${result.referenceDataSync.processed} processed, ${result.referenceDataSync.failed} failed`
    );
    console.log(
      `   Staff-Reference Links: ${result.linkReferencesSync.processed} processed, ${result.linkReferencesSync.failed} failed`
    );
    console.log(
      `   Hierarchy: ${result.hierarchySync.processed} processed, ${result.hierarchySync.failed} failed`
    );

    // Get sync status
    const status = await getSyncStatus();
    console.log("\n📈 Current Status:");
    console.log(`   Total Staff: ${status.totalStaff}`);
    console.log(`   Total Departments: ${status.totalDepartments}`);
    console.log(`   Total Job Titles: ${status.totalJobTitles}`);
    console.log(`   Total Offices: ${status.totalOffices}`);
  } catch (error) {
    console.error("❌ Sync failed:", error);
    process.exit(1);
  }
}

runSync();
