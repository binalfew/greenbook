import { data, Form, Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { getValidAccessToken, requireUser } from "~/lib/auth.server";
import {
  getFilterOptions,
  getMyProfile,
  getUsers,
  searchUsers,
} from "~/lib/graph.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Greenbook" },
    { name: "description", content: "Greenbook" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const user = await requireUser(request);
    const accessToken = await getValidAccessToken(request);

    let userProfile = null;
    if (accessToken) {
      try {
        userProfile = await getMyProfile(accessToken);
      } catch (error) {
        console.error("Failed to fetch user profile:", error);
        // Continue without profile - user can still use the app
      }
    }

    const url = new URL(request.url);
    const searchTerm = url.searchParams.get("search");
    const pageToken = url.searchParams.get("pageToken") || undefined;
    const department = url.searchParams.get("department");
    const jobTitle = url.searchParams.get("jobTitle");
    const officeLocation = url.searchParams.get("officeLocation");
    const clear = url.searchParams.get("clear");

    // If clear is set, redirect to the base page
    if (clear === "true") {
      return redirect("/");
    }

    // Get filter options
    const filterOptions = await getFilterOptions();

    // Prepare filters - convert "all" values to undefined
    const filters = {
      department: department && department !== "all" ? department : undefined,
      jobTitle: jobTitle && jobTitle !== "all" ? jobTitle : undefined,
      officeLocation:
        officeLocation && officeLocation !== "all" ? officeLocation : undefined,
    };

    let result;
    if (searchTerm) {
      result = await searchUsers(searchTerm, pageToken, filters);
    } else {
      result = await getUsers(pageToken, filters);
    }

    return data({
      user,
      userProfile,
      users: result.users,
      nextLink: result.nextLink,
      searchTerm,
      filters,
      filterOptions,
    });
  } catch {
    return data({
      user: null,
      userProfile: null,
      users: [],
      nextLink: undefined,
      searchTerm: null,
      filters: {},
      filterOptions: { departments: [], jobTitles: [], officeLocations: [] },
    });
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (!loaderData.user) {
    return (
      <div className="container mx-auto py-20 flex flex-col items-center text-center">
        <h1 className="text-3xl font-bold mb-4" style={{ color: "#40734b" }}>
          Welcome to Greenbook
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Discover your colleagues and connect with your organization.
        </p>
        <Form action="/auth/microsoft" method="POST">
          <Button
            type="submit"
            className="px-8 py-3 text-lg cursor-pointer"
            style={{ backgroundColor: "#40734b" }}
          >
            Login with Microsoft
          </Button>
        </Form>
      </div>
    );
  }

  const {
    user,
    userProfile,
    users,
    nextLink,
    searchTerm,
    filters,
    filterOptions,
  } = loaderData;

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        {/* Current User Profile */}
        {userProfile && (
          <Card>
            <CardHeader>
              <CardTitle>My Profile</CardTitle>
              <CardDescription>Your profile information</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-6">
                {/* Profile Photo */}
                <div className="flex-shrink-0">
                  <img
                    src={`/api/users/${userProfile.id}/photo`}
                    alt={`${userProfile.displayName}'s profile photo`}
                    className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                    onError={(e) => {
                      // Hide the image and show fallback on error
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextElementSibling?.classList.remove(
                        "hidden"
                      );
                    }}
                  />
                  <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200 hidden">
                    <span className="text-gray-500 font-semibold text-2xl">
                      {userProfile.displayName?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                  </div>
                </div>

                {/* Profile Details */}
                <div className="flex-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {userProfile.displayName}
                      </h3>
                      <p className="text-gray-600">
                        {userProfile.mail || userProfile.userPrincipalName}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {userProfile.jobTitle && (
                      <div>
                        <span className="font-medium text-gray-500">
                          Job Title:
                        </span>{" "}
                        {userProfile.jobTitle}
                      </div>
                    )}
                    {userProfile.department && (
                      <div>
                        <span className="font-medium text-gray-500">
                          Department:
                        </span>{" "}
                        {userProfile.department}
                      </div>
                    )}
                    {userProfile.officeLocation && (
                      <div>
                        <span className="font-medium text-gray-500">
                          Office Location:
                        </span>{" "}
                        {userProfile.officeLocation}
                      </div>
                    )}
                    {userProfile.employeeId && (
                      <div>
                        <span className="font-medium text-gray-500">
                          Employee ID:
                        </span>{" "}
                        {userProfile.employeeId}
                      </div>
                    )}
                    {userProfile.businessPhones &&
                      userProfile.businessPhones.length > 0 && (
                        <div>
                          <span className="font-medium text-gray-500">
                            Phone:
                          </span>{" "}
                          {userProfile.businessPhones[0]}
                        </div>
                      )}
                    {userProfile.mobilePhone && (
                      <div>
                        <span className="font-medium text-gray-500">
                          Mobile:
                        </span>{" "}
                        {userProfile.mobilePhone}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/profile">View Full Profile</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/token-status">Check Token Status</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Welcome Section (if no profile available) */}
        {!userProfile && (
          <Card>
            <CardHeader>
              <CardTitle>Welcome to Greenbook</CardTitle>
              <CardDescription>
                Discover your colleagues and connect with your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <Button asChild className="cursor-pointer">
                  <Link to="/profile">View My Profile</Link>
                </Button>
                <Button asChild variant="outline" className="cursor-pointer">
                  <Link to="/token-status">Check Token Status</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Users Directory */}
        <Card>
          <CardHeader>
            <CardTitle>Users Directory</CardTitle>
            <CardDescription>Find people in your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="get" className="space-y-4 mb-6">
              {/* Search and Filters Row */}
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Left side - Search and filters */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                  <Input
                    type="text"
                    name="search"
                    placeholder="Search African Union users by name or email..."
                    defaultValue={searchTerm || ""}
                  />

                  <Select
                    name="department"
                    defaultValue={filters.department || "all"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {filterOptions.departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    name="jobTitle"
                    defaultValue={filters.jobTitle || "all"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Job Titles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Job Titles</SelectItem>
                      {filterOptions.jobTitles.map((title) => (
                        <SelectItem key={title} value={title}>
                          {title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    name="officeLocation"
                    defaultValue={filters.officeLocation || "all"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Offices" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Offices</SelectItem>
                      {filterOptions.officeLocations.map((location) => (
                        <SelectItem key={location} value={location}>
                          {location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Right side - Action buttons */}
                <div className="flex gap-2 lg:flex-shrink-0">
                  <Button type="submit" className="cursor-pointer">
                    Search
                  </Button>
                  <Button
                    type="submit"
                    name="clear"
                    value="true"
                    variant="outline"
                    className="cursor-pointer"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </Form>

            {(searchTerm ||
              (filters.department && filters.department !== "all") ||
              (filters.jobTitle && filters.jobTitle !== "all") ||
              (filters.officeLocation && filters.officeLocation !== "all")) && (
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  {searchTerm && `Search results for "${searchTerm}"`}
                  {filters.department &&
                    filters.department !== "all" &&
                    ` • Department: ${filters.department}`}
                  {filters.jobTitle &&
                    filters.jobTitle !== "all" &&
                    ` • Job Title: ${filters.jobTitle}`}
                  {filters.officeLocation &&
                    filters.officeLocation !== "all" &&
                    ` • Office: ${filters.officeLocation}`}
                  {` • ${users.length} users found`}
                </p>
              </div>
            )}

            <div className="grid gap-4">
              {users.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">
                    {searchTerm ||
                    (filters.department && filters.department !== "all") ||
                    (filters.jobTitle && filters.jobTitle !== "all") ||
                    (filters.officeLocation && filters.officeLocation !== "all")
                      ? "No users found matching your criteria."
                      : "No users available."}
                  </p>
                </div>
              ) : (
                users.map((userProfile) => (
                  <Link
                    to={`/users/${userProfile.id}`}
                    key={userProfile.id}
                    className="block"
                  >
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          {/* Profile Photo */}
                          <div className="flex-shrink-0">
                            <img
                              src={`/api/users/${userProfile.id}/photo`}
                              alt={`${userProfile.displayName}'s profile photo`}
                              className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
                              onError={(e) => {
                                // Hide the image and show fallback on error
                                e.currentTarget.style.display = "none";
                                e.currentTarget.nextElementSibling?.classList.remove(
                                  "hidden"
                                );
                              }}
                            />
                            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200 hidden">
                              <span className="text-gray-500 font-semibold text-lg">
                                {userProfile.displayName
                                  ?.charAt(0)
                                  ?.toUpperCase() || "?"}
                              </span>
                            </div>
                          </div>

                          {/* User Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-lg truncate">
                                  {userProfile.displayName}
                                </h3>
                                <p className="text-gray-600 truncate">
                                  {userProfile.mail ||
                                    userProfile.userPrincipalName}
                                </p>
                                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                  {userProfile.jobTitle && (
                                    <div>
                                      <span className="font-medium text-gray-500">
                                        Job Title:
                                      </span>{" "}
                                      {userProfile.jobTitle}
                                    </div>
                                  )}
                                  {userProfile.department && (
                                    <div>
                                      <span className="font-medium text-gray-500">
                                        Department:
                                      </span>{" "}
                                      {userProfile.department}
                                    </div>
                                  )}
                                  {userProfile.officeLocation && (
                                    <div>
                                      <span className="font-medium text-gray-500">
                                        Office:
                                      </span>{" "}
                                      {userProfile.officeLocation}
                                    </div>
                                  )}
                                  {userProfile.employeeId && (
                                    <div>
                                      <span className="font-medium text-gray-500">
                                        Employee ID:
                                      </span>{" "}
                                      {userProfile.employeeId}
                                    </div>
                                  )}
                                </div>
                                {userProfile.businessPhones &&
                                  userProfile.businessPhones.length > 0 && (
                                    <div className="mt-2 text-sm">
                                      <span className="font-medium text-gray-500">
                                        Phone:
                                      </span>{" "}
                                      {userProfile.businessPhones[0]}
                                    </div>
                                  )}
                              </div>
                              <div className="ml-4 text-right">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    userProfile.accountEnabled
                                      ? "bg-green-100 text-green-800"
                                      : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {userProfile.accountEnabled
                                    ? "Active"
                                    : "Disabled"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))
              )}
            </div>

            {nextLink && (
              <div className="flex justify-end mt-6">
                <Form method="get">
                  {searchTerm && (
                    <input type="hidden" name="search" value={searchTerm} />
                  )}
                  {filters.department && filters.department !== "all" && (
                    <input
                      type="hidden"
                      name="department"
                      value={filters.department}
                    />
                  )}
                  {filters.jobTitle && filters.jobTitle !== "all" && (
                    <input
                      type="hidden"
                      name="jobTitle"
                      value={filters.jobTitle}
                    />
                  )}
                  {filters.officeLocation &&
                    filters.officeLocation !== "all" && (
                      <input
                        type="hidden"
                        name="officeLocation"
                        value={filters.officeLocation}
                      />
                    )}
                  <input type="hidden" name="pageToken" value={nextLink} />
                  <Button type="submit" className="cursor-pointer">
                    Next
                  </Button>
                </Form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
