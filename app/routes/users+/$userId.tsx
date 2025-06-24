import { data, redirect } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { requireUser } from "~/lib/auth.server";
import { getUserProfile } from "~/lib/graph.server";
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
    const user = await getUserProfile(userId);
    return data({ user });
  } catch (error) {
    return data({
      user: null,
      error: "Failed to load user details from Microsoft Graph",
    });
  }
}

export default function UserDetail({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const user = hasError ? null : loaderData.user;
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
      <Card>
        <CardHeader>
          <CardTitle>{user.displayName}</CardTitle>
          <CardDescription>User profile details</CardDescription>
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
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {user.createdDateTime && (
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Account Created
                </h3>
                <p className="mt-1 text-lg">
                  {new Date(user.createdDateTime).toLocaleDateString()}
                </p>
              </div>
            )}
            {user.lastPasswordChangeDateTime && (
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Last Password Change
                </h3>
                <p className="mt-1 text-lg">
                  {new Date(
                    user.lastPasswordChangeDateTime
                  ).toLocaleDateString()}
                </p>
              </div>
            )}
            {user.employeeHireDate && (
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Hire Date
                </h3>
                <p className="mt-1 text-lg">
                  {new Date(user.employeeHireDate).toLocaleDateString()}
                </p>
              </div>
            )}
            <div>
              <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                Account Status
              </h3>
              <p className="mt-1 text-lg">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.accountEnabled
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {user.accountEnabled ? "Active" : "Disabled"}
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
