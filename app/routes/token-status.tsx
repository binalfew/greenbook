import { data } from "react-router";
import {
  getTokenStatus,
  getValidAccessToken,
  requireUser,
} from "~/lib/auth.server";
import type { Route } from "./+types/token-status";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Token Status - Greenbook" },
    { name: "description", content: "Check your access token status" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const tokenStatus = await getTokenStatus(request);
  const validToken = await getValidAccessToken(request);

  return data({
    user,
    tokenStatus,
    hasValidToken: !!validToken,
  });
}

export default function TokenStatus({ loaderData }: Route.ComponentProps) {
  const { tokenStatus, hasValidToken } = loaderData;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Token Status</h1>

      <div className="grid gap-4">
        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Token Information</h2>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Has Access Token:</span>{" "}
              <span
                className={
                  tokenStatus.hasAccessToken ? "text-green-600" : "text-red-600"
                }
              >
                {tokenStatus.hasAccessToken ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="font-medium">Has Refresh Token:</span>{" "}
              <span
                className={
                  tokenStatus.hasRefreshToken
                    ? "text-green-600"
                    : "text-red-600"
                }
              >
                {tokenStatus.hasRefreshToken ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="font-medium">Can Auto-Refresh:</span>{" "}
              <span
                className={
                  tokenStatus.canAutoRefresh ? "text-green-600" : "text-red-600"
                }
              >
                {tokenStatus.canAutoRefresh ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="font-medium">Is Expired:</span>{" "}
              <span
                className={
                  tokenStatus.isExpired ? "text-red-600" : "text-green-600"
                }
              >
                {tokenStatus.isExpired ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="font-medium">Needs Re-authentication:</span>{" "}
              <span
                className={
                  tokenStatus.needsReauth ? "text-red-600" : "text-green-600"
                }
              >
                {tokenStatus.needsReauth ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="font-medium">Valid Token Available:</span>{" "}
              <span
                className={hasValidToken ? "text-green-600" : "text-red-600"}
              >
                {hasValidToken ? "Yes" : "No"}
              </span>
            </div>
            {tokenStatus.expiresAt && (
              <div>
                <span className="font-medium">Expires At:</span>{" "}
                <span className="text-gray-600">
                  {new Date(tokenStatus.expiresAt).toLocaleString()}
                </span>
              </div>
            )}
            {tokenStatus.timeUntilExpiry !== null && (
              <div>
                <span className="font-medium">Time Until Expiry:</span>{" "}
                <span
                  className={
                    tokenStatus.timeUntilExpiry > 0
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {Math.round(tokenStatus.timeUntilExpiry / 1000 / 60)} minutes
                </span>
              </div>
            )}
          </div>
        </div>

        {!tokenStatus.hasRefreshToken && (
          <div className="p-4 border border-yellow-300 rounded-lg bg-yellow-50">
            <h2 className="text-lg font-semibold mb-2 text-yellow-800">
              No Refresh Token Available
            </h2>
            <div className="text-sm text-yellow-700 space-y-2">
              <p>
                Your current authentication doesn't include a refresh token.
                This means:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  When your access token expires, you'll need to re-authenticate
                </li>
                <li>
                  You won't be able to automatically refresh tokens in the
                  background
                </li>
                <li>Users will be redirected to login when tokens expire</li>
              </ul>
              <p className="mt-2">
                <strong>To get refresh tokens:</strong> The application has been
                updated to request the <code>offline_access</code> scope. You'll
                need to log out and log back in to get refresh tokens for future
                sessions.
              </p>
            </div>
          </div>
        )}

        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Usage Examples</h2>
          <div className="space-y-2 text-sm">
            <p>
              <strong>Check if token is expired:</strong> Use{" "}
              <code>isTokenExpired(request)</code>
            </p>
            <p>
              <strong>Get valid token (with auto-refresh if available):</strong>{" "}
              Use <code>getValidAccessToken(request)</code>
            </p>
            <p>
              <strong>Get token with session updates:</strong> Use{" "}
              <code>getValidAccessTokenWithSession(request)</code>
            </p>
            <p>
              <strong>Manual token refresh:</strong> Use{" "}
              <code>refreshAccessToken(request)</code>
            </p>
            <p>
              <strong>Check token status:</strong> Use{" "}
              <code>getTokenStatus(request)</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
