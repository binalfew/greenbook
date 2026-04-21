export async function loader() {
  // Handle unknown routes
  throw new Response("Not Found", { status: 404 });
}

export default function CatchAll() {
  return null;
}
