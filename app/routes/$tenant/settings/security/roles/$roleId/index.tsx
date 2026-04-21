import { ArrowLeft, KeyRound, Pencil, Shield, Trash2, Users } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getRoleDetail } from "~/services/roles.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Detail" };

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data && "role" in data && data.role ? data.role.name : "Role" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "role", "read");
  const role = await getRoleDetail(params.roleId);
  if (!role) throw data({ error: "Role not found" }, { status: 404 });
  return data({ role });
}

export default function RoleDetailPage({ loaderData, params }: Route.ComponentProps) {
  const { role } = loaderData;
  const basePath = `/${params.tenant}/settings/security/roles`;

  // Group permissions by module for readability
  const permByModule = new Map<string, typeof role.rolePermissions>();
  for (const rp of role.rolePermissions) {
    const m = rp.permission.module ?? "other";
    if (!permByModule.has(m)) permByModule.set(m, []);
    permByModule.get(m)!.push(rp);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={basePath}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 flex size-14 items-center justify-center rounded-xl">
              <Shield className="text-primary size-7" />
            </div>
            <div>
              <h2 className="text-foreground text-2xl font-bold">{role.name}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{role.scope}</Badge>
                <span className="text-muted-foreground text-sm">
                  {role.tenant?.name ?? "Platform-wide"}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link to={`${basePath}/${role.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`${basePath}/${role.id}/permissions`}>
              <KeyRound className="mr-1.5 size-3.5" />
              Permissions
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild>
            <Link to={`${basePath}/${role.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Link>
          </Button>
        </div>
      </div>

      {role.description && (
        <Card>
          <CardContent className="pt-6 text-sm">{role.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Permissions ({role.rolePermissions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {role.rolePermissions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No permissions assigned.</p>
          ) : (
            <div className="space-y-4">
              {[...permByModule.entries()].map(([module, perms]) => (
                <div key={module}>
                  <p className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
                    {module}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {perms.map((rp) => (
                      <Badge key={rp.id} variant="secondary" className="font-mono text-xs">
                        {rp.permission.resource}:{rp.permission.action}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Members ({role.userRoles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {role.userRoles.length === 0 ? (
            <p className="text-muted-foreground text-sm">No users assigned to this role.</p>
          ) : (
            <div className="divide-y">
              {role.userRoles.map((ur) => {
                const name = `${ur.user.firstName} ${ur.user.lastName}`.trim() || ur.user.email;
                return (
                  <div key={ur.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{name}</span>
                    <span className="text-muted-foreground text-xs">{ur.user.email}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
