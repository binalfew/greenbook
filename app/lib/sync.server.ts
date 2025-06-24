import {
  getUserManager,
  getUserPhotoUrl,
  getUsers,
  type MicrosoftProfile,
} from "./graph.server";
import {
  getStaffByMicrosoftId,
  storeUserPhoto,
  syncHierarchyFromGraph,
  syncStaffFromGraph,
} from "./staff.server";

// Cancel sync function
export async function cancelSync(syncId: string): Promise<boolean> {
  const prisma = (await import("./prisma")).default;

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
  const prisma = (await import("./prisma")).default;

  const syncLog = await prisma.syncLog.findUnique({
    where: { id: syncId },
    select: { status: true },
  });

  if (syncLog?.status === "cancelled") {
    console.log("🛑 Cancellation detected, throwing error...");
    throw new Error("Sync was cancelled");
  }
}

// Sync all users from Microsoft Graph to database
export async function syncAllUsers(): Promise<{
  usersSync: any;
  hierarchySync: any;
  photosSync: any;
}> {
  console.log("🚀 Starting full user synchronization...");
  console.log("=".repeat(50));

  // Create master sync log
  const prisma = (await import("./prisma")).default;
  const masterSyncLog = await prisma.syncLog.create({
    data: {
      syncType: "full_sync",
      status: "running",
      startedAt: new Date(),
    },
  });

  console.log(`🆔 Sync ID set to: ${masterSyncLog.id}`);

  try {
    // Step 1: Sync all users
    console.log("📋 Step 1: Fetching users from Microsoft Graph...");
    const allUsers: MicrosoftProfile[] = [];
    let nextLink: string | undefined;
    let pageCount = 0;

    do {
      await checkCancellation(masterSyncLog.id);
      pageCount++;
      console.log(`   Fetching page ${pageCount}...`);
      const result = await getUsers(nextLink);
      await checkCancellation(masterSyncLog.id); // Check after API call
      allUsers.push(...result.users);
      nextLink = result.nextLink;
      console.log(
        `   Got ${result.users.length} users (total: ${allUsers.length})`
      );
    } while (nextLink);

    await checkCancellation(masterSyncLog.id);
    console.log(`✅ Found ${allUsers.length} total users to sync`);
    console.log("📝 Step 2: Syncing user data to database...");

    const usersSync = await syncStaffFromGraph(allUsers, masterSyncLog.id, () =>
      checkCancellation(masterSyncLog.id)
    );
    await checkCancellation(masterSyncLog.id);
    console.log(
      `✅ User sync completed: ${usersSync.recordsProcessed} processed, ${usersSync.recordsFailed} failed`
    );

    // Step 2: Sync organizational hierarchy
    console.log("🏢 Step 3: Building organizational hierarchy...");
    const hierarchyData: Array<{ staffId: string; managerId: string | null }> =
      [];

    for (let i = 0; i < allUsers.length; i++) {
      await checkCancellation(masterSyncLog.id);
      const user = allUsers[i];
      if (i % 5 === 0) {
        // Check more frequently
        console.log(
          `   Processing hierarchy for user ${i + 1}/${allUsers.length}...`
        );
      }

      try {
        const manager = await getUserManager(user.id);
        await checkCancellation(masterSyncLog.id); // Check after API call
        hierarchyData.push({
          staffId: user.id,
          managerId: manager?.id || null,
        });
      } catch (error) {
        console.error(`   ❌ Failed to get manager for ${user.id}:`, error);
        hierarchyData.push({
          staffId: user.id,
          managerId: null,
        });
      }
    }

    await checkCancellation(masterSyncLog.id);
    console.log(
      `✅ Hierarchy data collected for ${hierarchyData.length} users`
    );
    const hierarchySync = await syncHierarchyFromGraph(
      hierarchyData,
      masterSyncLog.id,
      () => checkCancellation(masterSyncLog.id)
    );
    await checkCancellation(masterSyncLog.id);
    console.log(
      `✅ Hierarchy sync completed: ${hierarchySync.recordsProcessed} processed, ${hierarchySync.recordsFailed} failed`
    );

    // Step 3: Sync user photos (optional, can be done separately)
    console.log("📸 Step 4: Syncing user photos...");
    const photosSync = { processed: 0, failed: 0 };

    for (let i = 0; i < allUsers.length; i++) {
      await checkCancellation(masterSyncLog.id);
      const user = allUsers[i];
      if (i % 5 === 0) {
        // Check more frequently
        console.log(
          `   Processing photos for user ${i + 1}/${allUsers.length}...`
        );
      }

      try {
        const photoData = await getUserPhotoUrl(user.id);
        await checkCancellation(masterSyncLog.id); // Check after API call
        if (photoData) {
          const staff = await getStaffByMicrosoftId(user.id);
          await checkCancellation(masterSyncLog.id); // Check after DB call
          if (staff) {
            await storeUserPhoto(staff.id, photoData);
            await checkCancellation(masterSyncLog.id); // Check after photo storage
            photosSync.processed++;
          }
        }
      } catch (error) {
        console.error(`   ❌ Failed to sync photo for ${user.id}:`, error);
        photosSync.failed++;
      }
    }

    await checkCancellation(masterSyncLog.id);
    console.log(
      `✅ Photo sync completed: ${photosSync.processed} processed, ${photosSync.failed} failed`
    );
    console.log("=".repeat(50));
    console.log("🎉 Full user synchronization completed!");
    console.log(`📊 Summary:`);
    console.log(
      `   Users: ${usersSync.recordsProcessed} processed, ${usersSync.recordsFailed} failed`
    );
    console.log(
      `   Hierarchy: ${hierarchySync.recordsProcessed} processed, ${hierarchySync.recordsFailed} failed`
    );
    console.log(
      `   Photos: ${photosSync.processed} processed, ${photosSync.failed} failed`
    );

    // Update master sync log as successful
    await prisma.syncLog.update({
      where: { id: masterSyncLog.id },
      data: {
        status: "success",
        recordsProcessed:
          usersSync.recordsProcessed +
          hierarchySync.recordsProcessed +
          photosSync.processed,
        recordsFailed:
          usersSync.recordsFailed +
          hierarchySync.recordsFailed +
          photosSync.failed,
        completedAt: new Date(),
      },
    });

    return { usersSync, hierarchySync, photosSync };
  } catch (error) {
    console.error("❌ Full sync failed:", error);

    // Update master sync log as failed or cancelled
    const status =
      error instanceof Error && error.message === "Sync was cancelled"
        ? "cancelled"
        : "error";

    await prisma.syncLog.update({
      where: { id: masterSyncLog.id },
      data: {
        status,
        message: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

// Incremental sync - only sync users that have been updated recently
export async function incrementalSync(): Promise<{
  usersSync: any;
  hierarchySync: any;
  photosSync: any;
}> {
  console.log("Starting incremental synchronization...");

  // For incremental sync, we could implement logic to:
  // 1. Check last sync timestamp
  // 2. Only sync users modified since last sync
  // 3. Update hierarchy for changed users only

  // For now, we'll do a full sync but this can be optimized later
  return syncAllUsers();
}

// Sync specific user
export async function syncUser(userId: string): Promise<{
  userSync: any;
  hierarchySync: any;
  photoSync: any;
}> {
  console.log(`Syncing user ${userId}...`);

  // Get user profile from Graph API
  const { getUserProfile } = await import("./graph.server");
  const user = await getUserProfile(userId);

  // Sync user data
  const userSync = await syncStaffFromGraph([user]);

  // Sync hierarchy
  const manager = await getUserManager(userId);
  const hierarchySync = await syncHierarchyFromGraph([
    {
      staffId: userId,
      managerId: manager?.id || null,
    },
  ]);

  // Sync photo
  let photoSync = { processed: 0, failed: 0 };
  try {
    const photoData = await getUserPhotoUrl(userId);
    if (photoData) {
      const staff = await getStaffByMicrosoftId(userId);
      if (staff) {
        await storeUserPhoto(staff.id, photoData);
        photoSync.processed = 1;
      }
    }
  } catch (error) {
    console.error(`Failed to sync photo for ${userId}:`, error);
    photoSync.failed = 1;
  }

  console.log(`User ${userId} sync completed`);
  return { userSync, hierarchySync, photoSync };
}

// Get sync status
export async function getSyncStatus() {
  const prisma = (await import("./prisma")).default;

  const recentSyncs = await prisma.syncLog.findMany({
    where: {
      OR: [
        { syncType: "full_sync" },
        { masterSyncLogId: null }, // Individual phase logs that aren't part of a full sync
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const totalStaff = await prisma.staff.count();
  const staffWithPhotos = await prisma.staff.count({
    where: { userPhoto: { isNot: null } },
  });

  return {
    recentSyncs,
    totalStaff,
    staffWithPhotos,
    photoCoverage: totalStaff > 0 ? (staffWithPhotos / totalStaff) * 100 : 0,
  };
}
