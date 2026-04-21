import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { deletePermission, getPermissionDetail } from "~/services/permissions.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/delete";

export const handle = { breadcrumb: "Delete" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Delete permission" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "permission", "delete");
  const permission = await getPermissionDetail(params.permissionId);
  if (!permission) throw data({ error: "Permission not found" }, { status: 404 });
  return data({ permission });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "permission", "delete");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const ctx = buildServiceContext(request, actor, tenantId);
  try {
    await deletePermission(params.permissionId, ctx);
    return redirect(`/${params.tenant}/settings/security/permissions`);
  } catch (error) {
    return data(
      { error: error instanceof Error ? error.message : "Failed to delete permission" },
      { status: 400 },
    );
  }
}

export default function DeletePermissionPage({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { permission } = loaderData;
  const canDelete = permission.rolePermissions.length === 0;
  const backTo = `/${params.tenant}/settings/security/permissions/${permission.id}`;
  const errorMessage =
    actionData && "error" in actionData ? (actionData as { error: string }).error : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Delete permission</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Permanently removes the permission from the platform.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-mono">
            {permission.resource}:{permission.action}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>
              <span className="text-foreground font-medium">Module:</span>{" "}
              <Badge variant="outline" className="capitalize">
                {permission.module}
              </Badge>
            </p>
            {permission.description && (
              <p>
                <span className="text-foreground font-medium">Description:</span>{" "}
                {permission.description}
              </p>
            )}
            <p>
              <span className="text-foreground font-medium">Assigned to roles:</span>{" "}
              {permission.rolePermissions.length}
            </p>
          </div>

          {errorMessage && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              {errorMessage}
            </div>
          )}

          {!canDelete ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              This permission is still assigned to {permission.rolePermissions.length} role
              {permission.rolePermissions.length === 1 ? "" : "s"}. Unassign it first.
            </div>
          ) : (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              This permission will be permanently deleted.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {canDelete ? (
              <Form method="post">
                <AuthenticityTokenInput />
                <Button type="submit" variant="destructive">
                  Delete permission
                </Button>
              </Form>
            ) : (
              <Button variant="destructive" disabled>
                Delete permission
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
