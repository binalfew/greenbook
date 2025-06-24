import type { Staff, SyncLog, UserPhoto } from "@prisma/client";
import type { MicrosoftProfile } from "./graph.server";
import prisma from "./prisma";

// Type for staff with photo data
export type StaffWithPhoto = Staff & {
  userPhoto?: UserPhoto | null;
  manager?: Staff | null;
  directReports?: Staff[];
};

// Convert Microsoft Graph profile to database format
function graphProfileToStaffData(profile: MicrosoftProfile) {
  return {
    microsoftId: profile.id,
    displayName: profile.displayName,
    givenName: profile.givenName,
    surname: profile.surname,
    userPrincipalName: profile.userPrincipalName,
    email: profile.mail || profile.userPrincipalName,
    jobTitle: profile.jobTitle,
    department: profile.department,
    officeLocation: profile.officeLocation,
    mobilePhone: profile.mobilePhone,
    businessPhones: profile.businessPhones || [],
    preferredLanguage: profile.preferredLanguage,
    employeeId: profile.employeeId,
    employeeType: profile.employeeType,
    employeeHireDate: profile.employeeHireDate
      ? new Date(profile.employeeHireDate)
      : null,
    usageLocation: profile.usageLocation,
    accountEnabled: profile.accountEnabled ?? true,
    createdDateTime: profile.createdDateTime
      ? new Date(profile.createdDateTime)
      : null,
    lastPasswordChangeDateTime: profile.lastPasswordChangeDateTime
      ? new Date(profile.lastPasswordChangeDateTime)
      : null,
    lastSyncAt: new Date(),
  };
}

// Get staff by Microsoft ID
export async function getStaffByMicrosoftId(
  microsoftId: string
): Promise<StaffWithPhoto | null> {
  return prisma.staff.findUnique({
    where: { microsoftId },
    include: {
      userPhoto: true,
      manager: true,
      directReports: true,
    },
  });
}

// Get staff by email
export async function getStaffByEmail(
  email: string
): Promise<StaffWithPhoto | null> {
  return prisma.staff.findUnique({
    where: { email },
    include: {
      userPhoto: true,
      manager: true,
      directReports: true,
    },
  });
}

// Get staff by ID
export async function getStaffById(id: string): Promise<StaffWithPhoto | null> {
  return prisma.staff.findUnique({
    where: { id },
    include: {
      userPhoto: true,
      manager: true,
      directReports: true,
    },
  });
}

// Get all staff with pagination and filtering
export async function getStaffList(params: {
  skip?: number;
  take?: number;
  department?: string;
  jobTitle?: string;
  officeLocation?: string;
  search?: string;
}): Promise<{ staff: StaffWithPhoto[]; total: number }> {
  const {
    skip = 0,
    take = 50,
    department,
    jobTitle,
    officeLocation,
    search,
  } = params;

  const where: any = {
    accountEnabled: true,
  };

  // Add filters
  if (department) where.department = department;
  if (jobTitle) where.jobTitle = jobTitle;
  if (officeLocation) where.officeLocation = officeLocation;

  // Add search
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { givenName: { contains: search, mode: "insensitive" } },
      { surname: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [staff, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      skip,
      take,
      orderBy: { displayName: "asc" },
      include: {
        userPhoto: true,
        manager: true,
        directReports: true,
      },
    }),
    prisma.staff.count({ where }),
  ]);

  return { staff, total };
}

// Get staff organizational hierarchy
export async function getStaffHierarchy(staffId: string): Promise<{
  manager: StaffWithPhoto | null;
  directReports: StaffWithPhoto[];
}> {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: {
      userPhoto: true,
      manager: {
        include: {
          userPhoto: true,
        },
      },
      directReports: {
        include: {
          userPhoto: true,
        },
      },
    },
  });

  return {
    manager: staff?.manager || null,
    directReports: staff?.directReports || [],
  };
}

// Get staff manager chain
export async function getStaffManagerChain(
  staffId: string
): Promise<StaffWithPhoto[]> {
  const managers: StaffWithPhoto[] = [];
  let currentStaffId = staffId;

  // Follow the manager chain up to 10 levels to prevent infinite loops
  for (let i = 0; i < 10; i++) {
    const staff = await prisma.staff.findUnique({
      where: { id: currentStaffId },
      include: {
        userPhoto: true,
        manager: {
          include: {
            userPhoto: true,
          },
        },
      },
    });

    if (!staff?.manager) break;

    managers.push(staff.manager);
    currentStaffId = staff.manager.id;
  }

  return managers;
}

// Get filter options
export async function getFilterOptions(): Promise<{
  departments: string[];
  jobTitles: string[];
  officeLocations: string[];
}> {
  const [departments, jobTitles, officeLocations] = await Promise.all([
    prisma.staff.findMany({
      where: { accountEnabled: true },
      select: { department: true },
      distinct: ["department"],
    }),
    prisma.staff.findMany({
      where: { accountEnabled: true },
      select: { jobTitle: true },
      distinct: ["jobTitle"],
    }),
    prisma.staff.findMany({
      where: { accountEnabled: true },
      select: { officeLocation: true },
      distinct: ["officeLocation"],
    }),
  ]);

  return {
    departments: departments
      .map((d) => d.department)
      .filter((dept): dept is string => Boolean(dept))
      .sort(),
    jobTitles: jobTitles
      .map((j) => j.jobTitle)
      .filter((title): title is string => Boolean(title))
      .sort(),
    officeLocations: officeLocations
      .map((o) => o.officeLocation)
      .filter((location): location is string => Boolean(location))
      .sort(),
  };
}

// Sync staff data from Microsoft Graph
export async function syncStaffFromGraph(
  profiles: MicrosoftProfile[],
  masterSyncLogId?: string,
  checkCancellation?: () => Promise<void>
): Promise<SyncLog> {
  const syncLog = await prisma.syncLog.create({
    data: {
      syncType: "users",
      status: "running",
      startedAt: new Date(),
      masterSyncLogId: masterSyncLogId || null,
    },
  });

  let processed = 0;
  let failed = 0;

  console.log(`📝 Starting user sync for ${profiles.length} profiles...`);

  try {
    for (let i = 0; i < profiles.length; i++) {
      // Check for cancellation
      if (checkCancellation) {
        await checkCancellation();
      }

      const profile = profiles[i];

      if (i % 10 === 0) {
        console.log(`   Processing user ${i + 1}/${profiles.length}...`);
      }

      try {
        const staffData = graphProfileToStaffData(profile);

        await prisma.staff.upsert({
          where: { microsoftId: profile.id },
          update: staffData,
          create: staffData,
        });

        // Check for cancellation after each database operation
        if (checkCancellation) {
          await checkCancellation();
        }

        processed++;
      } catch (error) {
        console.error(`   ❌ Failed to sync staff ${profile.id}:`, error);
        failed++;
      }
    }

    console.log(
      `📝 User sync completed: ${processed} processed, ${failed} failed`
    );

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: failed > 0 ? "partial" : "success",
        recordsProcessed: processed,
        recordsFailed: failed,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`❌ User sync failed:`, error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        recordsProcessed: processed,
        recordsFailed: failed,
        completedAt: new Date(),
      },
    });
  }

  return syncLog;
}

// Sync organizational hierarchy
export async function syncHierarchyFromGraph(
  hierarchyData: Array<{
    staffId: string;
    managerId: string | null;
  }>,
  masterSyncLogId?: string,
  checkCancellation?: () => Promise<void>
): Promise<SyncLog> {
  const syncLog = await prisma.syncLog.create({
    data: {
      syncType: "hierarchy",
      status: "running",
      startedAt: new Date(),
      masterSyncLogId: masterSyncLogId || null,
    },
  });

  let processed = 0;
  let failed = 0;

  console.log(
    `🏢 Starting hierarchy sync for ${hierarchyData.length} relationships...`
  );

  try {
    for (let i = 0; i < hierarchyData.length; i++) {
      // Check for cancellation
      if (checkCancellation) {
        await checkCancellation();
      }

      const { staffId, managerId } = hierarchyData[i];

      if (i % 10 === 0) {
        console.log(
          `   Processing hierarchy ${i + 1}/${hierarchyData.length}...`
        );
      }

      try {
        // First find the manager by microsoftId if managerId is provided
        let managerStaffId: string | null = null;
        if (managerId) {
          const manager = await prisma.staff.findUnique({
            where: { microsoftId: managerId },
            select: { id: true },
          });
          managerStaffId = manager?.id || null;

          if (!managerStaffId) {
            console.log(
              `   ⚠️  Manager with Microsoft ID ${managerId} not found in database`
            );
          }
        }

        // Update the staff member with their manager relationship
        const result = await prisma.staff.update({
          where: { microsoftId: staffId },
          data: {
            managerId: managerStaffId,
            lastSyncAt: new Date(),
          },
        });

        // Check for cancellation after each database operation
        if (checkCancellation) {
          await checkCancellation();
        }

        if (managerStaffId) {
          console.log(
            `   ✅ Set manager for ${staffId} -> ${managerId} (DB: ${managerStaffId})`
          );
        } else {
          console.log(`   - No manager for ${staffId}`);
        }

        processed++;
      } catch (error) {
        console.error(`   ❌ Failed to sync hierarchy for ${staffId}:`, error);
        failed++;
      }
    }

    console.log(
      `🏢 Hierarchy sync completed: ${processed} processed, ${failed} failed`
    );

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: failed > 0 ? "partial" : "success",
        recordsProcessed: processed,
        recordsFailed: failed,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`❌ Hierarchy sync failed:`, error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        recordsProcessed: processed,
        recordsFailed: failed,
        completedAt: new Date(),
      },
    });
  }

  return syncLog;
}

// Store user photo
export async function storeUserPhoto(
  staffId: string,
  photoData: string,
  contentType: string = "image/jpeg"
): Promise<void> {
  await prisma.userPhoto.upsert({
    where: { staffId },
    update: {
      photoData,
      contentType,
      lastSyncAt: new Date(),
    },
    create: {
      staffId,
      photoData,
      contentType,
    },
  });
}

// Get user photo
export async function getUserPhoto(staffId: string): Promise<UserPhoto | null> {
  return prisma.userPhoto.findUnique({
    where: { staffId },
  });
}
