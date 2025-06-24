import { data, Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireUser } from "~/lib/auth.server";
import { getUsers, searchUsers } from "~/lib/graph.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users - Greenbook" },
    { name: "description", content: "Browse users" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("search");
  const pageToken = url.searchParams.get("pageToken") || undefined;

  try {
    let result;
    if (searchTerm) {
      result = await searchUsers(searchTerm, pageToken);
    } else {
      result = await getUsers(pageToken);
    }
    return data({
      users: result.users,
      nextLink: result.nextLink,
      user,
      searchTerm,
    });
  } catch (error) {
    return data({
      users: [],
      nextLink: undefined,
      user,
      searchTerm,
      error: "Failed to load users from Microsoft Graph",
    });
  }
}

export default function Users({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const users = hasError ? [] : loaderData.users ?? [];
  const nextLink = loaderData.nextLink;
  const searchTerm = loaderData.searchTerm;
  const error = hasError ? String(loaderData.error) : null;

  return (
    <div className="container mx-auto py-8">
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Users Directory</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="get" className="flex gap-2 mb-6">
              <Input
                type="text"
                name="search"
                placeholder="Search users by name or email..."
                defaultValue={searchTerm || ""}
              />
              <Button type="submit">Search</Button>
              {searchTerm && (
                <Button type="submit" variant="outline" name="search" value="">
                  Clear
                </Button>
              )}
            </Form>
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-600">{error}</p>
              </div>
            )}
            {searchTerm && (
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  Search results for "{searchTerm}": {users.length} users found
                </p>
              </div>
            )}
            <div className="grid gap-4">
              {users.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">
                    {searchTerm
                      ? "No users found matching your search."
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
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg">
                              {userProfile.displayName}
                            </h3>
                            <p className="text-gray-600">
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
                  <input type="hidden" name="pageToken" value={nextLink} />
                  <Button type="submit" variant="outline">
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
