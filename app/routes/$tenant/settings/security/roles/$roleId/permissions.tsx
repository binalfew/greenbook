import { ArrowLeft, KeyRound } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { getRoleDetail, replaceRolePermissions } from "~/services/roles.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/permissions";

export const handle = { breadcrumb: "Permissions" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Role permissions" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "role", "update");
  const [role, allPermissions] = await Promise.all([
    getRoleDetail(params.roleId),
    prisma.permission.findMany({
      select: { id: true, resource: true, action: true, module: true, description: true },
      orderBy: [{ module: "asc" }, { resource: "asc" }, { action: "asc" }],
    }),
  ]);
  if (!role) throw data({ error: "Role not found" }, { status: 404 });

  const assignedIds = new Set(role.rolePermissions.map((rp) => rp.permission.id));
  return data({ role, allPermissions, assignedIds: [...assignedIds] });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "role", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const permissionIds = formData
    .getAll("permissionIds")
    .filter((v): v is string => typeof v === "string");

  const ctx = buildServiceContext(request, actor, tenantId);
  await replaceRolePermissions(params.roleId, permissionIds, ctx);

  return redirect(`/${params.tenant}/settings/security/roles/${params.roleId}`);
}

export default function RolePermissionsPage({ loaderData, params }: Route.ComponentProps) {
  const { role, allPermissions, assignedIds } = loaderData;
  const assigned = new Set(assignedIds);
  const backTo = `/${params.tenant}/settings/security/roles/${role.id}`;

  const byModule = new Map<string, typeof allPermissions>();
  for (const p of allPermissions) {
    const m = p.module ?? "other";
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-2xl font-bold">
            <KeyRound className="size-6" />
            Assign permissions
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Grouped by module. Tick everything this role should be able to do.
          </p>
        </div>
      </div>

      <Form method="post" className="space-y-6">
        <AuthenticityTokenInput />

        {[...byModule.entries()].map(([module, perms]) => (
          <Card key={module}>
            <CardHeader>
              <CardTitle className="text-sm tracking-wider uppercase">{module}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {perms.map((p) => (
                  <label
                    key={p.id}
                    className="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <Checkbox
                      name="permissionIds"
                      value={p.id}
                      defaultChecked={assigned.has(p.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <code className="text-xs font-semibold">
                        {p.resource}:{p.action}
                      </code>
                      {p.description && (
                        <p className="text-muted-foreground mt-0.5 text-xs">{p.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        <div className="flex gap-3">
          <Button type="submit">Save permissions</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
