import type { Staff, SyncLog } from "@prisma/client";
import type { MicrosoftProfile } from "./graph.server";
import prisma from "./prisma";

// Type for staff with hierarchy data
export type StaffWithHierarchy = Staff & {
  manager?: Staff | null;
  directReports?: Staff[];
};

// Type for filter options from reference tables
export type FilterOptions = {
  departments: Array<{ id: string; name: string }>;
  jobTitles: Array<{ id: string; title: string }>;
  officeLocations: string[];
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
): Promise<StaffWithHierarchy | null> {
  return prisma.staff.findUnique({
    where: { microsoftId },
    include: {
      manager: true,
      directReports: true,
    },
  });
}

// Get staff by email
export async function getStaffByEmail(
  email: string
): Promise<StaffWithHierarchy | null> {
  return prisma.staff.findUnique({
    where: { email },
    include: {
      manager: true,
      directReports: true,
    },
  });
}

// Get staff by ID
export async function getStaffById(
  id: string
): Promise<StaffWithHierarchy | null> {
  return prisma.staff.findUnique({
    where: { id },
    include: {
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
}): Promise<{ staff: StaffWithHierarchy[]; total: number }> {
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
  manager: StaffWithHierarchy | null;
  directReports: StaffWithHierarchy[];
}> {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: {
      manager: true,
      directReports: true,
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
): Promise<StaffWithHierarchy[]> {
  const managers: StaffWithHierarchy[] = [];
  let currentStaffId = staffId;

  // Follow the manager chain up to 10 levels to prevent infinite loops
  for (let i = 0; i < 10; i++) {
    const staff = await prisma.staff.findUnique({
      where: { id: currentStaffId },
      include: {
        manager: true,
      },
    });

    if (!staff?.manager) break;

    managers.push(staff.manager);
    currentStaffId = staff.manager.id;
  }

  return managers;
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

// Sync reference data (Organ, Department, JobTitle) from staff data
export async function syncReferenceData(
  profiles: MicrosoftProfile[],
  masterSyncLogId?: string,
  checkCancellation?: () => Promise<void>
): Promise<SyncLog> {
  const syncLog = await prisma.syncLog.create({
    data: {
      syncType: "reference_data",
      status: "running",
      startedAt: new Date(),
      masterSyncLogId: masterSyncLogId || null,
    },
  });

  let processed = 0;
  let failed = 0;

  console.log(`📋 Starting reference data sync...`);

  try {
    // Extract unique values from profiles
    const departments = new Set<string>();
    const jobTitles = new Set<string>();
    const offices = new Set<string>();

    profiles.forEach((profile) => {
      if (profile.department) departments.add(profile.department);
      if (profile.jobTitle) jobTitles.add(profile.jobTitle);
      if (profile.officeLocation) offices.add(profile.officeLocation);
    });

    console.log(
      `   Found ${departments.size} unique departments, ${jobTitles.size} unique job titles, and ${offices.size} unique offices`
    );

    // Sync departments
    for (const deptName of departments) {
      try {
        if (checkCancellation) await checkCancellation();

        await prisma.department.upsert({
          where: { name: deptName },
          update: {},
          create: { name: deptName },
        });

        processed++;
      } catch (error) {
        console.error(`   ❌ Failed to sync department ${deptName}:`, error);
        failed++;
      }
    }

    // Sync job titles
    for (const title of jobTitles) {
      try {
        if (checkCancellation) await checkCancellation();

        await prisma.jobTitle.upsert({
          where: { title },
          update: {},
          create: { title },
        });

        processed++;
      } catch (error) {
        console.error(`   ❌ Failed to sync job title ${title}:`, error);
        failed++;
      }
    }

    // Sync offices
    for (const officeName of offices) {
      try {
        if (checkCancellation) await checkCancellation();

        await prisma.office.upsert({
          where: { name: officeName },
          update: {},
          create: { name: officeName },
        });

        processed++;
      } catch (error) {
        console.error(`   ❌ Failed to sync office ${officeName}:`, error);
        failed++;
      }
    }

    console.log(
      `📋 Reference data sync completed: ${processed} processed, ${failed} failed`
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
    console.error(`❌ Reference data sync failed:`, error);
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

// Update staff records to link to reference tables
export async function linkStaffToReferenceData(
  profiles: MicrosoftProfile[],
  masterSyncLogId?: string,
  checkCancellation?: () => Promise<void>
): Promise<SyncLog> {
  const syncLog = await prisma.syncLog.create({
    data: {
      syncType: "link_references",
      status: "running",
      startedAt: new Date(),
      masterSyncLogId: masterSyncLogId || null,
    },
  });

  let processed = 0;
  let failed = 0;

  console.log(
    `🔗 Starting staff-reference linking for ${profiles.length} profiles...`
  );

  try {
    for (let i = 0; i < profiles.length; i++) {
      if (checkCancellation) await checkCancellation();

      const profile = profiles[i];

      if (i % 10 === 0) {
        console.log(
          `   Linking references for user ${i + 1}/${profiles.length}...`
        );
      }

      try {
        // Find department, job title, and office IDs
        let departmentId: string | null = null;
        let jobTitleId: string | null = null;
        let officeId: string | null = null;

        if (profile.department) {
          const dept = await prisma.department.findUnique({
            where: { name: profile.department },
            select: { id: true },
          });
          departmentId = dept?.id || null;
        }

        if (profile.jobTitle) {
          const title = await prisma.jobTitle.findUnique({
            where: { title: profile.jobTitle },
            select: { id: true },
          });
          jobTitleId = title?.id || null;
        }

        if (profile.officeLocation) {
          const office = await prisma.office.findUnique({
            where: { name: profile.officeLocation },
            select: { id: true },
          });
          officeId = office?.id || null;
        }

        // Update staff record with reference IDs
        await prisma.staff.update({
          where: { microsoftId: profile.id },
          data: {
            departmentId,
            jobTitleId,
            officeId,
            lastSyncAt: new Date(),
          },
        });

        processed++;
      } catch (error) {
        console.error(
          `   ❌ Failed to link references for ${profile.id}:`,
          error
        );
        failed++;
      }
    }

    console.log(
      `🔗 Staff-reference linking completed: ${processed} processed, ${failed} failed`
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
    console.error(`❌ Staff-reference linking failed:`, error);
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

// Get filter options from reference tables
export async function getFilterOptions(): Promise<FilterOptions> {
  const [departments, jobTitles, offices] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.jobTitle.findMany({
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.office.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    departments,
    jobTitles,
    officeLocations: offices.map((o) => o.name),
  };
}
