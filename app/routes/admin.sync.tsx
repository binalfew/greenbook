import { data, Form } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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
  return data({ status, user });
}

export async function action({ request }: any) {
  const user = await requireUser(request);

  // For now, any authenticated user can trigger sync
  // TODO: Add proper admin role check later
  // if (user.role !== "admin") {
  //   throw redirect("/");
  // }

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "sync") {
    try {
      const result = await syncAllUsers();
      return data({
        success: true,
        message: "Sync completed successfully",
        result,
      });
    } catch (error) {
      return data({
        success: false,
        message: error instanceof Error ? error.message : "Sync failed",
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
  const { status, user } = loaderData;
  const actionData = loaderData as any;

  // Check if there's a sync currently running
  const runningSync = status.recentSyncs.find(
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {status.totalStaff}
                </div>
                <div className="text-sm text-gray-600">Total Staff</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {status.staffWithPhotos}
                </div>
                <div className="text-sm text-gray-600">With Photos</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {status.photoCoverage.toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600">Photo Coverage</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sync Action */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Manual Synchronization</CardTitle>
            <CardDescription>
              Trigger a full synchronization from Microsoft Graph
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
              <p>This will:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Fetch all users from Microsoft Graph</li>
                <li>Update or create staff records in the database</li>
                <li>Build organizational hierarchy relationships</li>
                <li>Download and store user profile photos</li>
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
            {status.recentSyncs.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No sync logs found
              </p>
            ) : (
              <div className="space-y-3">
                {status.recentSyncs
                  .filter((sync: any) => sync.syncType === "full_sync")
                  .map((sync: any) => (
                    <div
                      key={sync.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">Full Sync</div>
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
                <p>
                  Users: {actionData.result.usersSync.recordsProcessed}{" "}
                  processed
                </p>
                <p>
                  Hierarchy: {actionData.result.hierarchySync.recordsProcessed}{" "}
                  processed
                </p>
                <p>
                  Photos: {actionData.result.photosSync.processed} processed
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
