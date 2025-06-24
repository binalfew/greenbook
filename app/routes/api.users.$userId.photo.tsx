import { requireUser } from "~/lib/auth.server";
import {
  getStaffById,
  getStaffByMicrosoftId,
  getUserPhoto,
} from "~/lib/staff.server";
import type { Route } from "./+types/api.users.$userId.photo";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const userId = params.userId;

  if (!userId) {
    return new Response("User ID required", { status: 400 });
  }

  try {
    // First try to find by database ID
    let staff = await getStaffById(userId);

    // If not found by ID, try to find by Microsoft ID
    if (!staff) {
      staff = await getStaffByMicrosoftId(userId);
    }

    if (!staff) {
      return new Response("User not found", { status: 404 });
    }

    // Get photo from database
    const photo = await getUserPhoto(staff.id);

    if (!photo) {
      return new Response("Photo not found", { status: 404 });
    }

    // Return the photo data
    return new Response(photo.photoData, {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Error loading user photo:", error);
    return new Response("Failed to load photo", { status: 500 });
  }
}
