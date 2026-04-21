import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { deleteTenant, getTenantWithCounts } from "~/services/tenants.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/delete";

export const handle = { breadcrumb: "Delete" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Delete tenant" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "tenant", "read");
  const tenant = await getTenantWithCounts(params.tenantId);
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }
  return data({ tenant });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "tenant", "delete");

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const ctx = buildServiceContext(request, user, params.tenantId);
  await deleteTenant(params.tenantId, ctx);

  return redirect(`/${params.tenant}/tenants`);
}

export default function DeleteTenantPage({ loaderData }: Route.ComponentProps) {
  const { tenant } = loaderData;
  const basePrefix = useBasePrefix();
  const canDelete = tenant._count.users === 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Delete tenant</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Review the details below before deleting this tenant.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tenant.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-foreground font-medium">Email</span>
              <p className="text-muted-foreground">{tenant.email}</p>
            </div>
            <div>
              <span className="text-foreground font-medium">Phone</span>
              <p className="text-muted-foreground">{tenant.phone}</p>
            </div>
            <div>
              <span className="text-foreground font-medium">Plan</span>
              <p className="text-muted-foreground capitalize">{tenant.subscriptionPlan}</p>
            </div>
            <div>
              <span className="text-foreground font-medium">Users</span>
              <p className="text-muted-foreground">{tenant._count.users}</p>
            </div>
            <div>
              <span className="text-foreground font-medium">Roles</span>
              <p className="text-muted-foreground">{tenant._count.roles}</p>
            </div>
          </div>

          {!canDelete ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              Cannot delete this tenant because it has {tenant._count.users} user
              {tenant._count.users === 1 ? "" : "s"}. Remove all users first.
            </div>
          ) : (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              This action cannot be undone. The tenant and all associated data will be permanently
              removed.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {canDelete ? (
              <Form method="post">
                <AuthenticityTokenInput />
                <Button type="submit" variant="destructive">
                  Delete tenant
                </Button>
              </Form>
            ) : (
              <Button variant="destructive" disabled>
                Delete tenant
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`${basePrefix}/tenants/${tenant.id}`}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
