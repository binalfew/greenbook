import { data, redirect } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { getAccessToken, requireUser } from "~/lib/auth.server";
import { getMyProfile } from "~/lib/graph.server";
import type { Route } from "./+types/profile";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Profile - Greenbook" },
    { name: "description", content: "Your Microsoft profile information" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const accessToken = await getAccessToken(request);
  if (!accessToken) throw redirect("/auth/microsoft");

  try {
    const profile = await getMyProfile(accessToken);
    return data({ profile, user });
  } catch (error: any) {
    // Check if the error is due to an expired token
    if (
      error.statusCode === 401 ||
      error.code === "InvalidAuthenticationToken"
    ) {
      // Token is expired, redirect directly to Microsoft auth
      throw redirect("/auth/microsoft");
    }

    return data({
      profile: null,
      user,
      error: "Failed to load profile from Microsoft Graph",
    });
  }
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const profile = hasError ? null : loaderData.profile;
  const error = hasError ? String(loaderData.error) : null;

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Error loading profile</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Loading profile...</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Loading your profile information...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Your Microsoft profile details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Name
                </h3>
                <p className="mt-1 text-lg">{profile.displayName}</p>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                  Email
                </h3>
                <p className="mt-1 text-lg">
                  {profile.mail || profile.userPrincipalName}
                </p>
              </div>
              {profile.jobTitle && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Job Title
                  </h3>
                  <p className="mt-1 text-lg">{profile.jobTitle}</p>
                </div>
              )}
              {profile.department && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Department
                  </h3>
                  <p className="mt-1 text-lg">{profile.department}</p>
                </div>
              )}
              {profile.officeLocation && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Office Location
                  </h3>
                  <p className="mt-1 text-lg">{profile.officeLocation}</p>
                </div>
              )}
              {profile.mobilePhone && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Mobile Phone
                  </h3>
                  <p className="mt-1 text-lg">{profile.mobilePhone}</p>
                </div>
              )}
              {profile.businessPhones && profile.businessPhones.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Business Phone
                  </h3>
                  <p className="mt-1 text-lg">{profile.businessPhones[0]}</p>
                </div>
              )}
              {profile.employeeId && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Employee ID
                  </h3>
                  <p className="mt-1 text-lg">{profile.employeeId}</p>
                </div>
              )}
              {profile.employeeType && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Employee Type
                  </h3>
                  <p className="mt-1 text-lg">{profile.employeeType}</p>
                </div>
              )}
              {profile.preferredLanguage && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Preferred Language
                  </h3>
                  <p className="mt-1 text-lg">{profile.preferredLanguage}</p>
                </div>
              )}
              {profile.usageLocation && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
                    Usage Location
                  </h3>
                  <p className="mt-1 text-lg">{profile.usageLocation}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
