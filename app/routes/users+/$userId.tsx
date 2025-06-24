import { data, Link, redirect } from "react-router";
import OrgChart from "~/components/org-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/lib/auth.server";
import type { MicrosoftProfile } from "~/lib/graph.server";
import {
  getStaffById,
  getStaffByMicrosoftId,
  getStaffHierarchy,
  type StaffWithPhoto,
} from "~/lib/staff.server";
import type { Route } from "./+types/$userId";

// Convert StaffWithPhoto to MicrosoftProfile for compatibility with existing components
function staffToMicrosoftProfile(staff: StaffWithPhoto): MicrosoftProfile {
  return {
    id: staff.microsoftId,
    displayName: staff.displayName,
    givenName: staff.givenName || undefined,
    surname: staff.surname || undefined,
    userPrincipalName: staff.userPrincipalName,
    mail: staff.email,
    jobTitle: staff.jobTitle || undefined,
    department: staff.department || undefined,
    officeLocation: staff.officeLocation || undefined,
    mobilePhone: staff.mobilePhone || undefined,
    businessPhones: staff.businessPhones,
    preferredLanguage: staff.preferredLanguage || undefined,
    employeeId: staff.employeeId || undefined,
    employeeType: staff.employeeType || undefined,
    employeeHireDate: staff.employeeHireDate?.toISOString() || undefined,
    usageLocation: staff.usageLocation || undefined,
    accountEnabled: staff.accountEnabled,
    createdDateTime: staff.createdDateTime?.toISOString() || undefined,
    lastPasswordChangeDateTime:
      staff.lastPasswordChangeDateTime?.toISOString() || undefined,
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "User Details - Greenbook" },
    {
      name: "description",
      content: "User profile details from the organization",
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const userId = params.userId;
  if (!userId) throw redirect("/users");

  try {
    // First try to find by database ID
    let staff = await getStaffById(userId);

    // If not found by ID, try to find by Microsoft ID
    if (!staff) {
      staff = await getStaffByMicrosoftId(userId);
    }

    if (!staff) {
      return data({
        user: null,
        manager: null,
        directReports: [],
        error: "User not found in database",
      });
    }

    const orgHierarchy = await getStaffHierarchy(staff.id);

    return data({
      user: staff,
      manager: orgHierarchy.manager,
      directReports: orgHierarchy.directReports,
    });
  } catch (error: any) {
    console.error("Error loading user details:", error);
    return data({
      user: null,
      manager: null,
      directReports: [],
      error: "Failed to load user details from database",
    });
  }
}

export default function UserDetail({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const user = hasError ? null : loaderData.user;
  const manager = hasError ? null : loaderData.manager;
  const directReports = hasError ? [] : loaderData.directReports || [];
  const error = hasError ? String(loaderData.error) : null;

  if (error || !user) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="p-6">
            <p className="text-red-600 text-center">
              {error || "User not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Convert to MicrosoftProfile for OrgChart compatibility
  const userProfile = staffToMicrosoftProfile(user);
  const managerProfile = manager ? staffToMicrosoftProfile(manager) : null;
  const directReportsProfiles = directReports.map(staffToMicrosoftProfile);

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        {/* User Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-gray-600 font-semibold text-2xl">
                  {user.displayName?.charAt(0)?.toUpperCase() || "?"}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold">{user.displayName}</h1>
                <p className="text-gray-600">{user.jobTitle}</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Email
                </h3>
                <p className="mt-1 text-lg">
                  {user.email || user.userPrincipalName}
                </p>
              </div>
              {user.jobTitle && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Job Title
                  </h3>
                  <p className="mt-1 text-lg">{user.jobTitle}</p>
                </div>
              )}
              {user.department && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Department
                  </h3>
                  <p className="mt-1 text-lg">{user.department}</p>
                </div>
              )}
              {user.officeLocation && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Office Location
                  </h3>
                  <p className="mt-1 text-lg">{user.officeLocation}</p>
                </div>
              )}
              {user.mobilePhone && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Mobile Phone
                  </h3>
                  <p className="mt-1 text-lg">{user.mobilePhone}</p>
                </div>
              )}
              {user.businessPhones && user.businessPhones.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Business Phone
                  </h3>
                  <p className="mt-1 text-lg">{user.businessPhones[0]}</p>
                </div>
              )}
              {user.employeeId && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Employee ID
                  </h3>
                  <p className="mt-1 text-lg">{user.employeeId}</p>
                </div>
              )}
              {user.employeeType && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Employee Type
                  </h3>
                  <p className="mt-1 text-lg">{user.employeeType}</p>
                </div>
              )}
              {user.preferredLanguage && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Preferred Language
                  </h3>
                  <p className="mt-1 text-lg">{user.preferredLanguage}</p>
                </div>
              )}
              {user.usageLocation && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Usage Location
                  </h3>
                  <p className="mt-1 text-lg">{user.usageLocation}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Organizational Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Organizational Chart</CardTitle>
            <CardDescription>
              Visual representation of reporting relationships
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrgChart
              currentUser={userProfile}
              manager={managerProfile}
              directReports={directReportsProfiles}
            />
          </CardContent>
        </Card>

        {/* Organizational Hierarchy */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Manager */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                Manager
              </CardTitle>
              <CardDescription>Who this person reports to</CardDescription>
            </CardHeader>
            <CardContent>
              {manager ? (
                <Link to={`/users/${manager.id}`} className="block">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                      <span className="text-gray-600 font-semibold">
                        {manager.displayName?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">
                        {manager.displayName}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {manager.jobTitle}
                      </p>
                      <p className="text-sm text-gray-500">{manager.email}</p>
                    </div>
                  </div>
                </Link>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No manager assigned
                </p>
              )}
            </CardContent>
          </Card>

          {/* Direct Reports */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                  />
                </svg>
                Direct Reports ({directReports.length})
              </CardTitle>
              <CardDescription>
                People who report to this person
              </CardDescription>
            </CardHeader>
            <CardContent>
              {directReports.length > 0 ? (
                <div className="space-y-2">
                  {directReports.map((report) => (
                    <Link
                      key={report.id}
                      to={`/users/${report.id}`}
                      className="block"
                    >
                      <div className="flex items-center gap-3 p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                          <span className="text-gray-600 font-semibold text-sm">
                            {report.displayName?.charAt(0)?.toUpperCase() ||
                              "?"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h5 className="font-medium text-gray-900 truncate">
                            {report.displayName}
                          </h5>
                          <p className="text-sm text-gray-600 truncate">
                            {report.jobTitle}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No direct reports
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
