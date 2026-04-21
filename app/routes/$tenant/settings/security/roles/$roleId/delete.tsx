import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { deleteRole, getRoleDetail } from "~/services/roles.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/delete";

export const handle = { breadcrumb: "Delete" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Delete role" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "role", "delete");
  const role = await getRoleDetail(params.roleId);
  if (!role) throw data({ error: "Role not found" }, { status: 404 });
  return data({ role });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "role", "delete");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const role = await getRoleDetail(params.roleId);
  if (role && role.userRoles.length > 0) {
    return data({ error: "Cannot delete a role with assigned members" }, { status: 400 });
  }

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const ctx = buildServiceContext(request, actor, tenantId);
  await deleteRole(params.roleId, ctx);

  return redirect(`/${params.tenant}/settings/security/roles`);
}

export default function DeleteRolePage({ loaderData, params }: Route.ComponentProps) {
  const { role } = loaderData;
  const canDelete = role.userRoles.length === 0;
  const backTo = `/${params.tenant}/settings/security/roles/${role.id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Delete role</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Removes the role and all its permission assignments.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{role.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>
              <span className="text-foreground font-medium">Scope:</span> {role.scope}
            </p>
            <p>
              <span className="text-foreground font-medium">Permissions:</span>{" "}
              {role.rolePermissions.length}
            </p>
            <p>
              <span className="text-foreground font-medium">Members:</span> {role.userRoles.length}
            </p>
          </div>

          {!canDelete ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              This role still has {role.userRoles.length} assigned member
              {role.userRoles.length === 1 ? "" : "s"}. Unassign them before deleting.
            </div>
          ) : (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              This role will be permanently deleted.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {canDelete ? (
              <Form method="post">
                <AuthenticityTokenInput />
                <Button type="submit" variant="destructive">
                  Delete role
                </Button>
              </Form>
            ) : (
              <Button variant="destructive" disabled>
                Delete role
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
