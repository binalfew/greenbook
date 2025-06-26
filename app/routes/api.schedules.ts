import { data } from "react-router";
import {
  createSchedule,
  deleteSchedule,
  getAllSchedules,
  getScheduleById,
  toggleSchedule,
  updateSchedule,
} from "~/lib/scheduler.server";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const schedule = await getScheduleById(id);
    if (!schedule) {
      return data({ error: "Schedule not found" }, { status: 404 });
    }
    return data({ schedule });
  }

  const schedules = await getAllSchedules();
  return data({ schedules });
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const action = formData.get("action") as string;

  try {
    switch (action) {
      case "create": {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const syncType = formData.get("syncType") as
          | "incremental"
          | "full"
          | "selective";
        const cronExpression = formData.get("cronExpression") as string;
        const enabled = formData.get("enabled") === "true";

        // Parse sync options
        const syncOptions = {
          users: formData.get("users") === "true",
          referenceData: formData.get("referenceData") === "true",
          hierarchy: formData.get("hierarchy") === "true",
          linkReferences: formData.get("linkReferences") === "true",
        };

        const schedule = await createSchedule({
          name,
          description,
          syncType,
          cronExpression,
          syncOptions,
          enabled,
        });

        return data({ success: true, schedule });
      }

      case "update": {
        const id = formData.get("id") as string;
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const syncType = formData.get("syncType") as
          | "incremental"
          | "full"
          | "selective";
        const cronExpression = formData.get("cronExpression") as string;
        const enabled = formData.get("enabled") === "true";

        // Parse sync options
        const syncOptions = {
          users: formData.get("users") === "true",
          referenceData: formData.get("referenceData") === "true",
          hierarchy: formData.get("hierarchy") === "true",
          linkReferences: formData.get("linkReferences") === "true",
        };

        const schedule = await updateSchedule(id, {
          name,
          description,
          syncType,
          cronExpression,
          syncOptions,
          enabled,
        });

        return data({ success: true, schedule });
      }

      case "delete": {
        const id = formData.get("id") as string;
        await deleteSchedule(id);
        return data({ success: true });
      }

      case "toggle": {
        const id = formData.get("id") as string;
        const enabled = formData.get("enabled") === "true";
        const schedule = await toggleSchedule(id, enabled);
        return data({ success: true, schedule });
      }

      default:
        return data({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Schedule API error:", error);
    return data(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
