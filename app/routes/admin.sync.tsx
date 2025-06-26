import { useState } from "react";
import { data, Form } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { requireUser } from "~/lib/auth.server";
import { cancelSync, getSyncStatus, syncAllUsers } from "~/lib/sync.server";

export function meta({}: any) {
  return [
    { title: "Data Sync - Greenbook" },
    { name: "description", content: "Synchronize data from Microsoft Graph" },
  ];
}

export async function loader({ request }: any) {
  const user = await requireUser(request);

  // For now, any authenticated user can access sync
  // TODO: Add proper admin role check later
  // if (user.role !== "admin") {
  //   throw redirect("/");
  // }

  const status = await getSyncStatus();
  return data({
    recentSyncs: status.recentSyncs,
    totalStaff: status.totalStaff,
    totalDepartments: status.totalDepartments,
    totalJobTitles: status.totalJobTitles,
    totalOffices: status.totalOffices,
  });
}

export async function action({ request }: any) {
  const user = await requireUser(request);

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "sync") {
    try {
      const result = await syncAllUsers();
      return data({
        success: true,
        message: "Full sync completed successfully",
        result,
      });
    } catch (error) {
      return data({
        success: false,
        message: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  if (action === "selective_sync") {
    try {
      // Parse sync options from form data
      const syncOptions = {
        users: formData.get("users") === "true",
        referenceData: formData.get("referenceData") === "true",
        hierarchy: formData.get("hierarchy") === "true",
        linkReferences: formData.get("linkReferences") === "true",
      };

      // Validate that at least one option is selected
      const hasOptions = Object.values(syncOptions).some(Boolean);
      if (!hasOptions) {
        return data({
          success: false,
          message: "At least one sync option must be selected",
        });
      }

      const { selectiveSync } = await import("~/lib/sync.server");
      const result = await selectiveSync(syncOptions);

      return data({
        success: true,
        message: "Selective sync completed successfully",
        result,
        options: syncOptions,
      });
    } catch (error) {
      return data({
        success: false,
        message:
          error instanceof Error ? error.message : "Selective sync failed",
      });
    }
  }

  if (action === "cancel") {
    const syncId = formData.get("syncId") as string;
    if (!syncId) {
      return data({
        success: false,
        message: "Sync ID is required",
      });
    }

    try {
      const cancelled = await cancelSync(syncId);
      if (cancelled) {
        return data({
          success: true,
          message: "Sync cancellation requested",
        });
      } else {
        return data({
          success: false,
          message: "Sync is not running or already completed",
        });
      }
    } catch (error) {
      return data({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to cancel sync",
      });
    }
  }

  return data({ success: false, message: "Invalid action" });
}

export default function AdminSync({ loaderData }: any) {
  const actionData = loaderData as any;

  const [formData, setFormData] = useState({
    users: true,
    referenceData: false,
    hierarchy: false,
    linkReferences: true,
  });

  // Check if there's a sync currently running
  const runningSync = loaderData.recentSyncs.find(
    (sync: any) => sync.status === "running"
  );

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Data Synchronization</h1>
          <p className="text-gray-600 mt-2">
            Synchronize user data from Microsoft Graph to the local database
          </p>
        </div>

        {/* Sync Status Indicator */}
        {runningSync && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                <div>
                  <div className="font-medium text-blue-800">
                    Sync in Progress
                  </div>
                  <div className="text-sm text-blue-600">
                    Started at{" "}
                    {new Date(runningSync.startedAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <Form method="post" className="flex-shrink-0">
                <input type="hidden" name="action" value="cancel" />
                <input type="hidden" name="syncId" value={runningSync.id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={(e) => {
                    if (
                      !confirm(
                        "Are you sure you want to cancel this sync? This action cannot be undone."
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  🛑 Cancel Sync
                </Button>
              </Form>
            </div>
          </div>
        )}

        {/* Current Status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Current Database Status</CardTitle>
            <CardDescription>Overview of synchronized data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {loaderData.totalStaff}
                </div>
                <div className="text-sm text-gray-600">Total Staff</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {loaderData.totalDepartments}
                </div>
                <div className="text-sm text-gray-600">Departments</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {loaderData.totalJobTitles}
                </div>
                <div className="text-sm text-gray-600">Job Titles</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {loaderData.totalOffices}
                </div>
                <div className="text-sm text-gray-600">Offices</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selective Sync */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Selective Synchronization</CardTitle>
            <CardDescription>
              Choose which data types to synchronize from Microsoft Graph
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-6">
              <input type="hidden" name="action" value="selective_sync" />

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="users"
                    name="users"
                    value="true"
                    checked={formData.users}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, users: checked as boolean })
                    }
                  />
                  <label htmlFor="users" className="text-sm font-medium">
                    Users
                  </label>
                </div>
                <p className="text-sm text-gray-600 ml-6">
                  Sync user profiles and basic information
                </p>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="referenceData"
                    name="referenceData"
                    value="true"
                    checked={formData.referenceData}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        referenceData: checked as boolean,
                      })
                    }
                  />
                  <label
                    htmlFor="referenceData"
                    className="text-sm font-medium"
                  >
                    Reference Data
                  </label>
                </div>
                <p className="text-sm text-gray-600 ml-6">
                  Sync departments, job titles, and offices
                </p>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hierarchy"
                    name="hierarchy"
                    value="true"
                    checked={formData.hierarchy}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        hierarchy: checked as boolean,
                      })
                    }
                  />
                  <label htmlFor="hierarchy" className="text-sm font-medium">
                    Organizational Hierarchy
                  </label>
                </div>
                <p className="text-sm text-gray-600 ml-6">
                  Build manager-direct report relationships
                </p>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="linkReferences"
                    name="linkReferences"
                    value="true"
                    checked={formData.linkReferences}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        linkReferences: checked as boolean,
                      })
                    }
                  />
                  <label
                    htmlFor="linkReferences"
                    className="text-sm font-medium"
                  >
                    Link References
                  </label>
                </div>
                <p className="text-sm text-gray-600 ml-6">
                  Link staff to department, job title, and office IDs
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={!!runningSync}>
                {runningSync
                  ? "🔄 Sync in Progress..."
                  : "🎯 Start Selective Sync"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* Full Sync Action */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Full Synchronization</CardTitle>
            <CardDescription>
              Sync all data types from Microsoft Graph
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <input type="hidden" name="action" value="sync" />
              <Button type="submit" className="w-full" disabled={!!runningSync}>
                {runningSync ? "🔄 Sync in Progress..." : "🚀 Start Full Sync"}
              </Button>
            </Form>

            {runningSync && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  ⚠️ A sync is currently running. You can cancel it using the
                  button above.
                </p>
              </div>
            )}

            <div className="mt-4 text-sm text-gray-600">
              <p>This will sync all data types:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Fetch all users from Microsoft Graph</li>
                <li>Update or create staff records in the database</li>
                <li>Sync reference data (departments, job titles, offices)</li>
                <li>Link staff to reference data for better performance</li>
                <li>Build organizational hierarchy relationships</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Recent Sync Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sync Logs</CardTitle>
            <CardDescription>
              History of synchronization attempts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loaderData.recentSyncs.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No sync logs found
              </p>
            ) : (
              <div className="space-y-3">
                {loaderData.recentSyncs
                  .filter(
                    (sync: any) =>
                      sync.syncType === "full_sync" ||
                      sync.syncType === "selective_sync"
                  )
                  .map((sync: any) => (
                    <div
                      key={sync.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">
                          {sync.syncType === "full_sync"
                            ? "Full Sync"
                            : "Selective Sync"}
                        </div>
                        <div className="text-sm text-gray-600">
                          {sync.recordsProcessed} processed,{" "}
                          {sync.recordsFailed} failed
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-medium ${
                            sync.status === "success"
                              ? "text-green-600"
                              : sync.status === "running"
                              ? "text-blue-600"
                              : sync.status === "cancelled"
                              ? "text-orange-600"
                              : sync.status === "partial"
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}
                        >
                          {sync.status}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(sync.startedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Results */}
        {actionData?.message && (
          <div
            className={`mt-6 p-4 rounded-lg ${
              actionData.success
                ? "bg-green-50 border border-green-200"
                : "bg-red-50 border border-red-200"
            }`}
          >
            <p
              className={actionData.success ? "text-green-800" : "text-red-800"}
            >
              {actionData.message}
            </p>
            {actionData.result && (
              <div className="mt-2 text-sm">
                {actionData.result.usersSync && (
                  <p>
                    Users: {actionData.result.usersSync.recordsProcessed}{" "}
                    processed
                  </p>
                )}
                {actionData.result.referenceDataSync && (
                  <p>
                    Reference Data:{" "}
                    {actionData.result.referenceDataSync.recordsProcessed}{" "}
                    processed
                  </p>
                )}
                {actionData.result.linkReferencesSync && (
                  <p>
                    Staff-Reference Links:{" "}
                    {actionData.result.linkReferencesSync.recordsProcessed}{" "}
                    processed
                  </p>
                )}
                {actionData.result.hierarchySync && (
                  <p>
                    Hierarchy:{" "}
                    {actionData.result.hierarchySync.recordsProcessed} processed
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
