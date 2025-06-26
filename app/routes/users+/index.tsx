import { data, Form, Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { requireUser } from "~/lib/auth.server";
import { getFilterOptions, getStaffList } from "~/lib/staff.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users - Greenbook" },
    { name: "description", content: "Browse users from the organization" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("search");
  const page = parseInt(url.searchParams.get("page") || "1");
  const department = url.searchParams.get("department");
  const jobTitle = url.searchParams.get("jobTitle");
  const officeLocation = url.searchParams.get("officeLocation");
  const clear = url.searchParams.get("clear");

  // If clear is set, redirect to the base users page
  if (clear === "true") {
    return redirect("/users");
  }

  try {
    // Get filter options
    const filterOptions = await getFilterOptions();

    // Prepare filters - convert "all" values to undefined
    const filters = {
      department: department && department !== "all" ? department : undefined,
      jobTitle: jobTitle && jobTitle !== "all" ? jobTitle : undefined,
      officeLocation:
        officeLocation && officeLocation !== "all" ? officeLocation : undefined,
    };

    // Calculate pagination
    const take = 50;
    const skip = (page - 1) * take;

    const result = await getStaffList({
      skip,
      take,
      search: searchTerm || undefined,
      ...filters,
    });

    return data({
      users: result.staff,
      total: result.total,
      currentPage: page,
      totalPages: Math.ceil(result.total / take),
      user,
      searchTerm,
      filters,
      filterOptions,
    });
  } catch (error: any) {
    console.error("Error loading users:", error);
    return data({
      users: [],
      total: 0,
      currentPage: 1,
      totalPages: 1,
      user,
      searchTerm,
      filters: {},
      filterOptions: {
        departments: [],
        jobTitles: [],
        officeLocations: [],
      },
      error: "Failed to load users from database",
    });
  }
}

export default function Users({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const users = hasError ? [] : loaderData.users ?? [];
  const total = loaderData.total;
  const currentPage = loaderData.currentPage;
  const totalPages = loaderData.totalPages;
  const searchTerm = loaderData.searchTerm;
  const filters = (loaderData.filters || {}) as {
    department?: string;
    jobTitle?: string;
    officeLocation?: string;
  };
  const filterOptions = loaderData.filterOptions || {
    departments: [] as Array<{ id: string; name: string }>,
    jobTitles: [] as Array<{ id: string; title: string }>,
    officeLocations: [] as string[],
  };
  const error = hasError ? String(loaderData.error) : null;

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Users Directory</CardTitle>
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
                        <SelectItem key={dept.id} value={dept.name}>
                          {dept.name}
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
                        <SelectItem key={title.id} value={title.title}>
                          {title.title}
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
                  {/* cursor-pointer */}
                  <Button type="submit" className="cursor-pointer">
                    Search
                  </Button>
                </div>
              </div>
            </Form>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-600">{error}</p>
              </div>
            )}

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
                          {/* Profile Avatar */}
                          <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200">
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
                                  {userProfile.email ||
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

            {totalPages > 1 && (
              <div className="flex justify-center mt-6">
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
                  <input type="hidden" name="page" value={currentPage} />
                  <Button type="submit" className="cursor-pointer">
                    Previous
                  </Button>
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
