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
import { requireUser } from "~/lib/auth.server";
import {
  getFilterOptions,
  getStaffByEmail,
  getStaffList,
} from "~/lib/staff.server";
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

    // Get current user's profile from database
    let userProfile = null;
    try {
      userProfile = await getStaffByEmail(user.email);
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
      // Continue without profile - user can still use the app
    }

    const url = new URL(request.url);
    const searchTerm = url.searchParams.get("search");
    const page = parseInt(url.searchParams.get("page") || "1");
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
      user,
      userProfile,
      users: result.staff,
      total: result.total,
      currentPage: page,
      totalPages: Math.ceil(result.total / take),
      searchTerm,
      filters,
      filterOptions,
    });
  } catch {
    return data({
      user: null,
      userProfile: null,
      users: [],
      total: 0,
      currentPage: 1,
      totalPages: 1,
      searchTerm: null,
      filters: {},
      filterOptions: {
        departments: [] as Array<{ id: string; name: string }>,
        jobTitles: [] as Array<{ id: string; title: string }>,
        officeLocations: [] as string[],
      },
    });
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (!loaderData.user) {
    return (
      <div className="min-h-screen">
        {/* Hero Section */}
        <div className="container mx-auto px-4 py-2">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-primary/10 rounded-full mb-8">
              <svg
                className="w-10 h-10 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome to{" "}
              <span className="text-primary">African Union Greenbook</span>
            </h1>
            <p className="text-lg text-gray-600 mb-6 max-w-2xl mx-auto leading-relaxed">
              Connect with your colleagues, discover your organization's
              network, and build meaningful relationships across departments and
              offices.
            </p>
          </div>

          {/* Features Section */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Find Colleagues
              </h3>
              <p className="text-gray-600">
                Search and discover team members across your organization with
                advanced filtering by department, role, and location.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Build Connections
              </h3>
              <p className="text-gray-600">
                Connect with colleagues, understand organizational structure,
                and foster collaboration across teams and departments.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-purple-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Organizational Insights
              </h3>
              <p className="text-gray-600">
                Gain insights into your organization's structure, departments,
                and team dynamics with comprehensive profiles and analytics.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const {
    user,
    userProfile,
    users,
    total,
    currentPage,
    totalPages,
    searchTerm,
    filters,
    filterOptions,
  } = loaderData;

  return (
    <div className="container mx-auto">
      <div className="grid gap-6">
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
              <div className="flex justify-center mt-6 gap-2">
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
                  <input
                    type="hidden"
                    name="page"
                    value={Math.max(1, currentPage - 1)}
                  />
                  <Button
                    type="submit"
                    className="cursor-pointer"
                    disabled={currentPage <= 1}
                  >
                    Previous
                  </Button>
                </Form>

                <span className="flex items-center px-4 text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>

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
                  <input
                    type="hidden"
                    name="page"
                    value={Math.min(totalPages, currentPage + 1)}
                  />
                  <Button
                    type="submit"
                    className="cursor-pointer"
                    disabled={currentPage >= totalPages}
                  >
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
