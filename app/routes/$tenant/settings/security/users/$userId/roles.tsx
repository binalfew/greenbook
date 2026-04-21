import { ArrowLeft, Shield } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { getUserDetail, replaceUserRoles } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
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

  const [user, allRoles] = await Promise.all([
    getUserDetail(params.userId),
    prisma.role.findMany({
      where: { OR: [{ tenantId }, { scope: "GLOBAL" }] },
      select: { id: true, name: true, scope: true, description: true },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
    }),
  ]);
  if (!user) throw data({ error: "User not found" }, { status: 404 });

  const assignedIds = new Set(user.userRoles.map((ur) => ur.role.id));
  return data({ user, allRoles, assignedIds: [...assignedIds] });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "user", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const roleIds = formData.getAll("roleIds").filter((v): v is string => typeof v === "string");

  const ctx = buildServiceContext(request, actor, tenantId);
  await replaceUserRoles(params.userId, roleIds, ctx);

  return redirect(`/${params.tenant}/settings/security/users/${params.userId}`);
}

export default function UserRolesPage({ loaderData, params }: Route.ComponentProps) {
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
