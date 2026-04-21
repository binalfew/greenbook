import { ArrowLeft, KeyRound, Pencil, Shield, Trash2 } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getPermissionDetail } from "~/services/permissions.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Detail" };

export function meta({ data }: Route.MetaArgs) {
  const p = data && "permission" in data ? data.permission : null;
  return [{ title: p ? `${p.resource}:${p.action}` : "Permission" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "permission", "read");
  const permission = await getPermissionDetail(params.permissionId);
  if (!permission) throw data({ error: "Permission not found" }, { status: 404 });
  return data({ permission });
}

export default function PermissionDetailPage({ loaderData, params }: Route.ComponentProps) {
  const { permission } = loaderData;
  const basePath = `/${params.tenant}/settings/security/permissions`;

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
              <KeyRound className="text-primary size-7" />
            </div>
            <div>
              <h2 className="text-foreground font-mono text-2xl font-bold">
                {permission.resource}:{permission.action}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {permission.module}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link to={`${basePath}/${permission.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild>
            <Link to={`${basePath}/${permission.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Link>
          </Button>
        </div>
      </div>

      {permission.description && (
        <Card>
          <CardContent className="pt-6 text-sm">{permission.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-4" />
            Assigned to roles ({permission.rolePermissions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {permission.rolePermissions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No roles use this permission yet.</p>
          ) : (
            <div className="divide-y">
              {permission.rolePermissions.map((rp) => (
                <div key={rp.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Shield className="text-muted-foreground size-4" />
                    <span className="font-medium">{rp.role.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {rp.role.scope}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {rp.role.tenant?.name ?? "Platform-wide"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
