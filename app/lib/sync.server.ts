import type {
  SyncLogDetail,
  SyncLogWithDetails,
  SyncOptions,
  SyncResult,
  SyncResults,
} from "~/types/sync";
import {
  getUserManager,
  getUserProfile,
  getUsers,
  type MicrosoftProfile,
} from "./graph.server";
import prisma from "./prisma";
import {
  getStaffByMicrosoftId,
  linkStaffToReferenceData,
  syncHierarchyFromGraph,
  syncReferenceData,
  syncStaffFromGraph,
} from "./staff.server";

// Cancel sync function
export async function cancelSync(syncId: string): Promise<boolean> {
  console.log(`🛑 Cancel sync requested for ID: ${syncId}`);

  // Check if sync exists and is running
  const syncLog = await prisma.syncLog.findUnique({
    where: { id: syncId },
  });

  if (!syncLog) {
    console.log(`🛑 Sync not found`);
    return false;
  }

  if (syncLog.status !== "running") {
    console.log(`🛑 Sync is not running (status: ${syncLog.status})`);
    return false;
  }

  // Update sync log to cancelled status
  await prisma.syncLog.update({
    where: { id: syncId },
    data: {
      status: "cancelled",
      message: "Sync was cancelled by user",
      completedAt: new Date(),
    },
  });

  console.log("🛑 Sync cancellation requested...");
  return true;
}

// Check if sync should be cancelled by checking database
async function checkCancellation(syncId: string): Promise<void> {
  const syncLog = await prisma.syncLog.findUnique({
    where: { id: syncId },
    select: { status: true },
  });

  if (syncLog?.status === "cancelled") {
    console.log("🛑 Cancellation detected, throwing error...");
    throw new Error("Sync was cancelled");
  }
}

// Selective sync function
export async function selectiveSync(
  options: SyncOptions = {},
  scheduleId?: string
): Promise<SyncResults> {
  console.log("🎯 Starting selective synchronization...");
  console.log("=".repeat(50));
  console.log("Selected sync options:", options);
  if (scheduleId) {
    console.log(`📅 Scheduled sync triggered by schedule: ${scheduleId}`);
  }

  // Create master sync log
  const masterSyncLog = await prisma.syncLog.create({
    data: {
      syncType: "selective_sync",
      status: "running",
      startedAt: new Date(),
      scheduleId: scheduleId || null,
    },
  });

  console.log(`🆔 Sync ID set to: ${masterSyncLog.id}`);

  const results: SyncResults = {};
  let allUsers: MicrosoftProfile[] = [];

  try {
    // Step 1: Fetch users if needed for any sync type
    if (options.users || options.hierarchy || options.referenceData) {
      console.log("📋 Step 1: Fetching users from Microsoft Graph...");
      let nextLink: string | undefined;
      let pageCount = 0;

      do {
        await checkCancellation(masterSyncLog.id);
        pageCount++;
        console.log(`   Fetching page ${pageCount}...`);
        const result = await getUsers(nextLink);
        await checkCancellation(masterSyncLog.id);
        allUsers.push(...result.users);
        nextLink = result.nextLink;
        console.log(
          `   Got ${result.users.length} users (total: ${allUsers.length})`
        );
      } while (nextLink);

      await checkCancellation(masterSyncLog.id);
      console.log(`✅ Found ${allUsers.length} total users`);
    }

    // Step 2: Sync users if selected OR if hierarchy is selected (needed for hierarchy sync)
    if (options.users || options.hierarchy) {
      console.log("📝 Step 2: Syncing user data to database...");
      results.usersSync = await syncStaffFromGraph(
        allUsers,
        masterSyncLog.id,
        () => checkCancellation(masterSyncLog.id)
      );
      await checkCancellation(masterSyncLog.id);
      console.log(
        `✅ User sync completed: ${results.usersSync?.recordsProcessed} processed, ${results.usersSync?.recordsFailed} failed`
      );
    }

    // Step 3: Sync reference data if selected
    if (options.referenceData) {
      console.log(
        "📋 Step 3: Syncing reference data (departments, job titles)..."
      );
      results.referenceDataSync = await syncReferenceData(
        allUsers,
        masterSyncLog.id,
        () => checkCancellation(masterSyncLog.id)
      );
      await checkCancellation(masterSyncLog.id);
      console.log(
        `✅ Reference data sync completed: ${results.referenceDataSync?.recordsProcessed} processed, ${results.referenceDataSync?.recordsFailed} failed`
      );
    }

    // Step 4: Link staff to reference data if needed
    if (options.linkReferences && (options.users || options.referenceData)) {
      console.log("🔗 Step 4: Linking staff to reference data...");
      results.linkReferencesSync = await linkStaffToReferenceData(
        allUsers,
        masterSyncLog.id,
        () => checkCancellation(masterSyncLog.id)
      );
      await checkCancellation(masterSyncLog.id);
      console.log(
        `✅ Staff-reference linking completed: ${results.linkReferencesSync?.recordsProcessed} processed, ${results.linkReferencesSync?.recordsFailed} failed`
      );
    }

    // Step 5: Sync hierarchy if selected
    if (options.hierarchy) {
      console.log("🏢 Step 5: Building organizational hierarchy...");
      const hierarchyData: Array<{
        staffId: string;
        managerId: string | null;
      }> = [];

      for (let i = 0; i < allUsers.length; i++) {
        await checkCancellation(masterSyncLog.id);
        const user = allUsers[i];
        if (i % 5 === 0) {
          console.log(
            `   Processing hierarchy for user ${i + 1}/${allUsers.length}...`
          );
        }

        try {
          const manager = await getUserManager(user.id);
          await checkCancellation(masterSyncLog.id);

          if (manager) {
            const managerStaff = await getStaffByMicrosoftId(manager.id);
            hierarchyData.push({
              staffId: user.id,
              managerId: manager.id,
            });
          } else {
            hierarchyData.push({
              staffId: user.id,
              managerId: null,
            });
          }
        } catch (error) {
          console.error(`   ❌ Failed to get manager for ${user.id}:`, error);
          hierarchyData.push({
            staffId: user.id,
            managerId: null,
          });
        }
      }

      await checkCancellation(masterSyncLog.id);
      results.hierarchySync = await syncHierarchyFromGraph(
        hierarchyData,
        masterSyncLog.id,
        () => checkCancellation(masterSyncLog.id)
      );
      await checkCancellation(masterSyncLog.id);
      console.log(
        `✅ Hierarchy sync completed: ${results.hierarchySync.recordsProcessed} processed, ${results.hierarchySync.recordsFailed} failed`
      );
    }

    console.log("=".repeat(50));
    console.log("🎉 Selective synchronization completed!");
    console.log(`📊 Summary:`);

    let totalProcessed = 0;
    let totalFailed = 0;

    if (results.usersSync) {
      console.log(
        `   Users: ${results.usersSync.recordsProcessed} processed, ${results.usersSync.recordsFailed} failed`
      );
      totalProcessed += results.usersSync.recordsProcessed;
      totalFailed += results.usersSync.recordsFailed;
    }
    if (results.referenceDataSync) {
      console.log(
        `   Reference Data: ${results.referenceDataSync.recordsProcessed} processed, ${results.referenceDataSync.recordsFailed} failed`
      );
      totalProcessed += results.referenceDataSync.recordsProcessed;
      totalFailed += results.referenceDataSync.recordsFailed;
    }
    if (results.linkReferencesSync) {
      console.log(
        `   Staff-Reference Links: ${results.linkReferencesSync.recordsProcessed} processed, ${results.linkReferencesSync.recordsFailed} failed`
      );
      totalProcessed += results.linkReferencesSync.recordsProcessed;
      totalFailed += results.linkReferencesSync.recordsFailed;
    }
    if (results.hierarchySync) {
      console.log(
        `   Hierarchy: ${results.hierarchySync.recordsProcessed} processed, ${results.hierarchySync.recordsFailed} failed`
      );
      totalProcessed += results.hierarchySync.recordsProcessed;
      totalFailed += results.hierarchySync.recordsFailed;
    }

    // Update master sync log to success
    await prisma.syncLog.update({
      where: { id: masterSyncLog.id },
      data: {
        status: "success",
        recordsProcessed: totalProcessed,
        recordsFailed: totalFailed,
        completedAt: new Date(),
      },
    });

    return results;
  } catch (error) {
    console.error("❌ Selective sync failed:", error);

    // Update master sync log to error
    await prisma.syncLog.update({
      where: { id: masterSyncLog.id },
      data: {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

// Keep the existing syncAllUsers function for backward compatibility
export async function syncAllUsers(): Promise<SyncResults> {
  const result = await selectiveSync({
    users: true,
    referenceData: true,
    linkReferences: true,
    hierarchy: true,
  });

  return {
    usersSync: result.usersSync!,
    referenceDataSync: result.referenceDataSync!,
    linkReferencesSync: result.linkReferencesSync!,
    hierarchySync: result.hierarchySync!,
  };
}

// Incremental sync - only sync users that have been updated recently
export async function incrementalSync(
  options: SyncOptions = {},
  scheduleId?: string
): Promise<Pick<SyncResults, "usersSync" | "hierarchySync">> {
  console.log("🔄 Starting incremental synchronization...");
  if (scheduleId) {
    console.log(
      `📅 Scheduled incremental sync triggered by schedule: ${scheduleId}`
    );
  }

  // For incremental sync, we could implement logic to:
  // 1. Check last sync timestamp
  // 2. Only sync users modified since last sync
  // 3. Update hierarchy for changed users only

  // For now, we'll do a selective sync with the provided options
  const result = await selectiveSync(
    {
      users: true,
      hierarchy: true,
      ...options,
    },
    scheduleId
  );

  return {
    usersSync: result.usersSync!,
    hierarchySync: result.hierarchySync!,
  };
}

// Sync specific user
export async function syncUser(userId: string): Promise<{
  userSync: SyncResult;
  hierarchySync: SyncResult;
}> {
  console.log(`👤 Starting sync for user: ${userId}`);

  // Get user profile from Microsoft Graph
  const userProfile = await getUserProfile(userId);

  // Sync user data
  const userSync = await syncStaffFromGraph([userProfile]);

  // Sync hierarchy for this user
  let hierarchySync: SyncResult = {
    recordsProcessed: 0,
    recordsFailed: 0,
    status: "success",
  };
  try {
    const manager = await getUserManager(userId);

    if (manager) {
      const hierarchyData = [
        {
          staffId: userId,
          managerId: manager.id,
        },
      ];
      hierarchySync = await syncHierarchyFromGraph(hierarchyData);
    }
  } catch (error) {
    console.error(`❌ Failed to sync hierarchy for user ${userId}:`, error);
    hierarchySync = {
      recordsProcessed: 0,
      recordsFailed: 1,
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return { userSync, hierarchySync };
}

// Get sync status
export async function getSyncStatus(): Promise<{
  recentSyncs: SyncLogWithDetails[];
  totalStaff: number;
  totalDepartments: number;
  totalJobTitles: number;
  totalOffices: number;
}> {
  // Get master sync logs (full_sync, selective_sync, incremental_sync)
  const masterSyncs = await prisma.syncLog.findMany({
    where: {
      syncType: {
        in: ["full_sync", "selective_sync", "incremental_sync"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Get child sync logs for each master sync
  const syncsWithDetails = await Promise.all(
    masterSyncs.map(async (masterSync) => {
      const childLogs = await prisma.syncLog.findMany({
        where: {
          masterSyncLogId: masterSync.id,
        },
        orderBy: { createdAt: "asc" },
      });

      // Calculate totals from child logs
      let totalProcessed = 0;
      let totalFailed = 0;
      const childDetails: SyncLogDetail[] = childLogs.map((child) => {
        totalProcessed += child.recordsProcessed;
        totalFailed += child.recordsFailed;
        return {
          id: child.id,
          syncType: child.syncType,
          status: child.status,
          recordsProcessed: child.recordsProcessed,
          recordsFailed: child.recordsFailed,
          startedAt: child.startedAt,
          completedAt: child.completedAt,
        };
      });

      return {
        ...masterSync,
        childLogs: childDetails,
        totalProcessed,
        totalFailed,
      } as SyncLogWithDetails;
    })
  );

  const [totalStaff, totalDepartments, totalJobTitles, totalOffices] =
    await Promise.all([
      prisma.staff.count(),
      prisma.department.count(),
      prisma.jobTitle.count(),
      prisma.office.count(),
    ]);

  return {
    recentSyncs: syncsWithDetails,
    totalStaff,
    totalDepartments,
    totalJobTitles,
    totalOffices,
  };
}
