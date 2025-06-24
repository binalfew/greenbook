import { data } from "react-router";
import { requireUser } from "~/lib/auth.server";
import {
  getSyncStatus,
  incrementalSync,
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

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const userId = formData.get("userId") as string;

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
