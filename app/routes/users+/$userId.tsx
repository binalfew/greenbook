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
import {
  getUserOrgHierarchy,
  getUserPhotoUrl,
  getUserProfile,
} from "~/lib/graph.server";
import type { Route } from "./+types/$userId";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "User Details - Greenbook" },
    {
      name: "description",
      content: "User profile details from Microsoft Graph",
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const userId = params.userId;
  if (!userId) throw redirect("/users");

  try {
    const [user, photoUrl, orgHierarchy] = await Promise.all([
      getUserProfile(userId),
      getUserPhotoUrl(userId),
      getUserOrgHierarchy(userId),
    ]);

    return data({
      user: { ...user, photoUrl },
      manager: orgHierarchy.manager,
      directReports: orgHierarchy.directReports,
    });
  } catch (error: any) {
    // Check if the error is due to an expired token
    if (
      error.statusCode === 401 ||
      error.code === "InvalidAuthenticationToken"
    ) {
      // Token is expired, redirect directly to Microsoft auth
      console.log("Token is expired, redirecting to Microsoft auth");
      throw redirect("/auth/microsoft");
    }

    return data({
      user: null,
      manager: null,
      directReports: [],
      error: "Failed to load user details from Microsoft Graph",
    });
  }
}

export default function UserDetail({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const user = hasError ? null : loaderData.user;
  const manager = hasError ? null : loaderData.manager;
  const directReports = hasError ? [] : loaderData.directReports || [];
  const error = hasError ? String(loaderData.error) : null;

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>User Details</CardTitle>
            <CardDescription>Error loading user details</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>User Details</CardTitle>
            <CardDescription>Loading user details...</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Loading user profile information...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        {/* User Profile Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              {/* Profile Photo */}
              <div className="flex-shrink-0">
                {user.photoUrl ? (
                  <img
                    src={user.photoUrl}
                    alt={`${user.displayName}'s profile photo`}
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200">
                    <span className="text-gray-500 font-semibold text-2xl">
                      {user.displayName?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <CardTitle>{user.displayName}</CardTitle>
                <CardDescription>User profile details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Email
                </h3>
                <p className="mt-1 text-lg">
                  {user.mail || user.userPrincipalName}
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
                      <p className="text-sm text-gray-500">{manager.mail}</p>
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

        {/* Organizational Chart */}
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
              Organizational Chart
            </CardTitle>
            <CardDescription>
              Visual representation of reporting relationships
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrgChart
              currentUser={user}
              manager={manager}
              directReports={directReports}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
