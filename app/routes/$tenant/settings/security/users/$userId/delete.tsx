import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getUserDetail, softDeleteUser } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/delete";

export const handle = { breadcrumb: "Delete" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Delete user" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "user", "delete");
  const user = await getUserDetail(params.userId);
  if (!user) throw data({ error: "User not found" }, { status: 404 });
  return data({ user });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "user", "delete");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  if (params.userId === actor.id) {
    return data({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const ctx = buildServiceContext(request, actor, tenantId);
  await softDeleteUser(params.userId, ctx);

  return redirect(`/${params.tenant}/settings/security/users`);
}

export default function DeleteUserPage({ loaderData, params }: Route.ComponentProps) {
  const { user } = loaderData;
  const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  const backTo = `/${params.tenant}/settings/security/users/${user.id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Delete user</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Soft-delete marks the account as removed but preserves audit history.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{displayName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>
              <span className="text-foreground font-medium">Email:</span> {user.email}
            </p>
            <p>
              <span className="text-foreground font-medium">Status:</span>{" "}
              {user.userStatus?.code ?? "—"}
            </p>
            <p>
              <span className="text-foreground font-medium">Roles:</span>{" "}
              {user.userRoles.length === 0
                ? "None"
                : user.userRoles.map((ur) => ur.role.name).join(", ")}
            </p>
          </div>

          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            This user will no longer be able to sign in. Their data remains for audit purposes.
          </div>

          <div className="flex gap-3 pt-2">
            <Form method="post">
              <AuthenticityTokenInput />
              <Button type="submit" variant="destructive">
                Delete user
              </Button>
            </Form>
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
