import { requireUser } from "~/lib/auth.server";
import { getUserPhotoUrl } from "~/lib/graph.server";

export async function loader({ request, params }: any) {
  await requireUser(request);
  const userId = params.userId;

  if (!userId) {
    return new Response("User ID required", { status: 400 });
  }

  try {
    const photoUrl = await getUserPhotoUrl(userId);

    if (!photoUrl) {
      return new Response("Photo not found", { status: 404 });
    }

    // Extract the base64 data from the data URL
    const base64Data = photoUrl.split(",")[1];
    const buffer = Buffer.from(base64Data, "base64");

    return new Response(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Error fetching user photo:", error);
    return new Response("Failed to fetch photo", { status: 500 });
  }
}
