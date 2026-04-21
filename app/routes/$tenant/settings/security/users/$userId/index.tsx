import { ArrowLeft, Pencil, Shield, Trash2, User as UserIcon } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { getUserDetail } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Detail" };

export function meta({ data }: Route.MetaArgs) {
  const name =
    data && "user" in data && data.user
      ? `${data.user.firstName} ${data.user.lastName}`.trim() || data.user.email
      : "User";
  return [{ title: name }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "user", "read");
  const user = await getUserDetail(params.userId);
  if (!user) {
    throw data({ error: "User not found" }, { status: 404 });
  }
  return data({ user });
}

export default function UserDetailPage({ loaderData, params }: Route.ComponentProps) {
  const { user } = loaderData;
  const basePath = `/${params.tenant}/settings/security/users`;
  const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email;

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
              <UserIcon className="text-primary size-7" />
            </div>
            <div>
              <h2 className="text-foreground text-2xl font-bold">{displayName}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-sm">{user.email}</span>
                {user.userStatus && <Badge variant="outline">{user.userStatus.code}</Badge>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link to={`${basePath}/${user.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`${basePath}/${user.id}/roles`}>
              <Shield className="mr-1.5 size-3.5" />
              Roles
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild>
            <Link to={`${basePath}/${user.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Row label="First name" value={user.firstName} />
          <Row label="Last name" value={user.lastName} />
          <Row label="Email" value={user.email} />
          <Row label="Status" value={user.userStatus?.name ?? "—"} />
          <Row
            label="Last login"
            value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}
          />
          <Row label="Created" value={new Date(user.createdAt).toLocaleString()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles ({user.userRoles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {user.userRoles.length === 0 ? (
            <p className="text-muted-foreground text-sm">No roles assigned.</p>
          ) : (
            <div className="divide-y">
              {user.userRoles.map((ur, i) => (
                <div key={ur.id}>
                  {i > 0 && <Separator className="my-2" />}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <Shield className="text-muted-foreground size-4" />
                      <span className="text-sm font-medium">{ur.role.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {ur.role.scope}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-0.5 font-medium break-words">{value || "—"}</p>
    </div>
  );
}
