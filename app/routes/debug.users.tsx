import { data } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getStaffList } from "~/lib/staff.server";
import type { Route } from "./+types/debug.users";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Debug Users - Greenbook" },
    { name: "description", content: "Debug user data" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const result = await getStaffList({ take: 10 });

    return data({
      users: result.staff.map((user) => ({
        id: user.id,
        microsoftId: user.microsoftId,
        displayName: user.displayName,
        email: user.email,
        userPrincipalName: user.userPrincipalName,
      })),
      total: result.total,
    });
  } catch (error: any) {
    console.error("Error loading debug users:", error);
    return data({
      users: [],
      total: 0,
      error: error.message,
    });
  }
}

export default function DebugUsers({ loaderData }: Route.ComponentProps) {
  const hasError = "error" in loaderData;
  const users = hasError ? [] : loaderData.users;
  const total = hasError ? 0 : loaderData.total;
  const error = hasError ? String(loaderData.error) : null;

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold">Error</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Debug Users ({total} total)</h1>

        <div className="space-y-4">
          {users.map((user: any) => (
            <div key={user.id} className="border rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Database ID:</strong> {user.id}
                </div>
                <div>
                  <strong>Microsoft ID:</strong> {user.microsoftId}
                </div>
                <div>
                  <strong>Display Name:</strong> {user.displayName}
                </div>
                <div>
                  <strong>Email:</strong> {user.email}
                </div>
                <div>
                  <strong>UPN:</strong> {user.userPrincipalName}
                </div>
                <div>
                  <strong>Links:</strong>
                  <div className="mt-1 space-y-1">
                    <a
                      href={`/users/${user.id}`}
                      className="block text-blue-600 hover:underline"
                    >
                      By DB ID: /users/{user.id}
                    </a>
                    <a
                      href={`/users/${user.microsoftId}`}
                      className="block text-blue-600 hover:underline"
                    >
                      By MS ID: /users/{user.microsoftId}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
