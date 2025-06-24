import { data } from "react-router";
import { requireUser } from "~/lib/auth.server";
import prisma from "~/lib/prisma";

export function meta({}: any) {
  return [
    { title: "Debug Hierarchy - Greenbook" },
    { name: "description", content: "Debug hierarchical data" },
  ];
}

export async function loader({ request }: any) {
  await requireUser(request);

  try {
    // Get some users with their manager relationships
    const staffWithManagers = await prisma.staff.findMany({
      take: 10,
      include: {
        manager: {
          select: {
            id: true,
            microsoftId: true,
            displayName: true,
            email: true,
          },
        },
        directReports: {
          select: {
            id: true,
            microsoftId: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    // Get some users who have managers
    const usersWithManagers = staffWithManagers.filter((s) => s.managerId);

    // Get some users who have direct reports
    const usersWithReports = staffWithManagers.filter(
      (s) => s.directReports.length > 0
    );

    return data({
      totalStaff: staffWithManagers.length,
      usersWithManagers: usersWithManagers.length,
      usersWithReports: usersWithReports.length,
      sampleUsers: staffWithManagers.map((user) => ({
        id: user.id,
        microsoftId: user.microsoftId,
        displayName: user.displayName,
        email: user.email,
        managerId: user.managerId,
        manager: user.manager
          ? {
              id: user.manager.id,
              microsoftId: user.manager.microsoftId,
              displayName: user.manager.displayName,
              email: user.manager.email,
            }
          : null,
        directReportsCount: user.directReports.length,
        directReports: user.directReports.map((report) => ({
          id: report.id,
          microsoftId: report.microsoftId,
          displayName: report.displayName,
          email: report.email,
        })),
      })),
    });
  } catch (error: any) {
    console.error("Error loading debug hierarchy:", error);
    return data({
      totalStaff: 0,
      usersWithManagers: 0,
      usersWithReports: 0,
      sampleUsers: [],
      error: error.message,
    });
  }
}

export default function DebugHierarchy({ loaderData }: any) {
  const hasError = "error" in loaderData;
  const totalStaff = hasError ? 0 : loaderData.totalStaff;
  const usersWithManagers = hasError ? 0 : loaderData.usersWithManagers;
  const usersWithReports = hasError ? 0 : loaderData.usersWithReports;
  const sampleUsers = hasError ? [] : loaderData.sampleUsers;
  const error = hasError ? String(loaderData.error) : null;

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold">Error</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Debug Hierarchy</h1>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{totalStaff}</div>
            <div className="text-sm text-blue-600">Total Staff</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-600">
              {usersWithManagers}
            </div>
            <div className="text-sm text-green-600">With Managers</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">
              {usersWithReports}
            </div>
            <div className="text-sm text-purple-600">With Direct Reports</div>
          </div>
        </div>

        <div className="space-y-4">
          {sampleUsers.map((user: any) => (
            <div key={user.id} className="border rounded-lg p-4">
              <div className="mb-3">
                <h3 className="font-semibold text-lg">{user.displayName}</h3>
                <p className="text-gray-600">{user.email}</p>
                <p className="text-sm text-gray-500">
                  DB ID: {user.id} | MS ID: {user.microsoftId}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">Manager</h4>
                  {user.manager ? (
                    <div className="bg-green-50 p-3 rounded">
                      <p className="font-medium">{user.manager.displayName}</p>
                      <p className="text-sm text-gray-600">
                        {user.manager.email}
                      </p>
                      <p className="text-xs text-gray-500">
                        DB ID: {user.manager.id} | MS ID:{" "}
                        {user.manager.microsoftId}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-3 rounded text-gray-500">
                      No manager assigned
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-2">
                    Direct Reports ({user.directReportsCount})
                  </h4>
                  {user.directReports.length > 0 ? (
                    <div className="space-y-2">
                      {user.directReports.map((report: any) => (
                        <div key={report.id} className="bg-blue-50 p-2 rounded">
                          <p className="font-medium text-sm">
                            {report.displayName}
                          </p>
                          <p className="text-xs text-gray-600">
                            {report.email}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-3 rounded text-gray-500">
                      No direct reports
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
