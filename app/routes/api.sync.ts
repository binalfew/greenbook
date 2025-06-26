import { data } from "react-router";
import { requireUser } from "~/lib/auth.server";
import {
  getSyncStatus,
  incrementalSync,
  selectiveSync,
  syncAllUsers,
  syncUser,
} from "~/lib/sync.server";
import type { Route } from "./+types/api.sync";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const userId = url.searchParams.get("userId");

  try {
    switch (action) {
      case "full":
        const fullSync = await syncAllUsers();
        return data({ success: true, sync: fullSync });

      case "incremental":
        const incSync = await incrementalSync();
        return data({ success: true, sync: incSync });

      case "user":
        if (!userId) {
          return data({ success: false, error: "userId parameter required" });
        }
        const userSync = await syncUser(userId);
        return data({ success: true, sync: userSync });

      case "status":
        const status = await getSyncStatus();
        return data({ success: true, status });

      default:
        return data({ success: false, error: "Invalid action" });
    }
  } catch (error: any) {
    console.error("Sync error:", error);
    return data({
      success: false,
      error: error.message || "Sync operation failed",
    });
  }
}

export async function action({ request }: { request: Request }) {
  const user = await requireUser(request);

  // For now, any authenticated user can trigger sync
  // TODO: Add proper admin role check later
  // if (user.role !== "admin") {
  //   return data({ error: "Unauthorized" }, { status: 403 });
  // }

  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const action = formData.get("action") as string;

    if (action === "selective_sync") {
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
        return data(
          { error: "At least one sync option must be selected" },
          { status: 400 }
        );
      }

      const result = await selectiveSync(syncOptions);
      return data({
        success: true,
        message: "Selective sync completed successfully",
        result,
        options: syncOptions,
      });
    }

    return data({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("API sync error:", error);
    return data(
      {
        error: "Sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
