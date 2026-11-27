import type { StoredPhoto } from "~/utils/photo-storage.server";

// Photos are only ever sent to a logged-in user, so the response is private.
// `no-cache` makes the browser revalidate (and so re-check the session) every
// time; a photo's content never changes, so its id doubles as the ETag.
const PHOTO_CACHE_HEADER = "private, no-cache";

export function photoResponse(request: Request, photo: StoredPhoto | null): Response {
  if (!photo) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const etag = `"${photo.id}"`;
  const headers = {
    "Cache-Control": PHOTO_CACHE_HEADER,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      ...headers,
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.byteLength),
    },
  });
}
