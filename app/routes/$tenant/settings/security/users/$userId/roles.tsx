import { ArrowLeft, Shield } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { RoleScope } from "~/generated/prisma/client";
import { LastAdminError, replaceUserRoles } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { assertCanGrantRoles, requireUserInScope } from "~/utils/auth/user-access.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/roles";

export const handle = { breadcrumb: "Roles" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "User roles" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(request, "user", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });
  const isGlobalAdmin = actor.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");

  // Roles are global definitions (4 platform-wide rows). Managers see only
  // TENANT-scope roles (focal, manager) — granting GLOBAL roles (admin, user)
  // is platform-admin-only, otherwise a manager could self-elevate by
  // granting themselves the GLOBAL `admin` role.
  const roleWhere = isGlobalAdmin ? {} : { scope: RoleScope.TENANT };

  const [user, allRoles] = await Promise.all([
    requireUserInScope(actor, params.userId, "write"),
    prisma.role.findMany({
      where: roleWhere,
      select: { id: true, name: true, scope: true, description: true },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
    }),
  ]);

  const assignedIds = new Set(user.userRoles.map((ur) => ur.role.id));
  return data({ user, allRoles, assignedIds: [...assignedIds] });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "user", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  // Hand-crafted POSTs can target any user id and smuggle in any role id, so
  // both are checked here even though the loader already hides them.
  await requireUserInScope(actor, params.userId, "write");

  const formData = await request.formData();
  const roleIds = formData.getAll("roleIds").filter((v): v is string => typeof v === "string");
  await assertCanGrantRoles(actor, roleIds);
  await validateCSRF(formData, request.headers);

  const ctx = buildServiceContext(request, actor, tenantId);
  try {
    await replaceUserRoles(params.userId, roleIds, ctx);
  } catch (error) {
    if (!(error instanceof LastAdminError)) throw error;
    return data({ error: error.message }, { status: 400 });
  }

  return redirect(`/${params.tenant}/settings/security/users/${params.userId}`);
}

export default function UserRolesPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { user, allRoles, assignedIds } = loaderData;
  const assigned = new Set(assignedIds);
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
          <h2 className="text-foreground flex items-center gap-2 text-2xl font-bold">
            <Shield className="size-6" />
            Assign roles
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage role assignments for {displayName}.
          </p>
        </div>
      </div>

      <Form method="post" className="space-y-6">
        <AuthenticityTokenInput />

        {actionData?.error ? (
          <p className="text-destructive text-sm" role="alert">
            {actionData.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Roles ({allRoles.length} available)</CardTitle>
          </CardHeader>
          <CardContent>
            {allRoles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No roles defined yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allRoles.map((r) => (
                  <label
                    key={r.id}
                    className="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <Checkbox
                      name="roleIds"
                      value={r.id}
                      defaultChecked={assigned.has(r.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground text-xs">{r.scope}</span>
                      </div>
                      {r.description && (
                        <p className="text-muted-foreground mt-0.5 text-xs">{r.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Save roles</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
