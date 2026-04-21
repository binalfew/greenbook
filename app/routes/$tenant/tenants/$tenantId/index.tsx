import { Building2, Clock, Mail, MapPin, Pencil, Phone, Shield, Trash2, Users } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { getTenantWithCounts } from "~/services/tenants.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { BRAND_THEMES } from "~/utils/schemas/organization";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Details" };

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.tenant?.name ?? "Tenant" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "tenant", "read");

  const tenant = await getTenantWithCounts(params.tenantId);
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }
  return data({ tenant });
}

export default function TenantDetailPage({ loaderData }: Route.ComponentProps) {
  const { tenant } = loaderData;
  const basePrefix = useBasePrefix();

  const brandLabel =
    BRAND_THEMES.find((t) => t.value === (tenant.brandTheme ?? ""))?.label ?? "Default";

  const address = [tenant.address, tenant.city, tenant.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 flex size-14 items-center justify-center rounded-xl">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt={tenant.name}
                className="size-12 rounded-lg object-contain"
              />
            ) : (
              <Building2 className="text-primary size-7" />
            )}
          </div>
          <div>
            <h2 className="text-foreground text-2xl font-bold">{tenant.name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">/{tenant.slug}</span>
              <Badge variant="default" className="capitalize">
                {tenant.subscriptionPlan}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`${basePrefix}/tenants`}>Back</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to={`${basePrefix}/tenants/${tenant.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild>
            <Link to={`${basePrefix}/tenants/${tenant.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Users className="size-3" />
            Users
          </div>
          <p className="mt-1 text-lg font-bold">{tenant._count.users}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Shield className="size-3" />
            Roles
          </div>
          <p className="mt-1 text-lg font-bold">{tenant._count.roles}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Clock className="size-3" />
            Created
          </div>
          <p className="mt-1 text-sm font-bold">
            {new Date(tenant.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact &amp; details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <Mail className="text-muted-foreground size-4 shrink-0" />
                <a href={`mailto:${tenant.email}`} className="text-primary hover:underline">
                  {tenant.email}
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="text-muted-foreground size-4 shrink-0" />
                <span>{tenant.phone || "—"}</span>
              </div>
              {address && (
                <div className="flex items-start gap-3">
                  <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>{address}</span>
                </div>
              )}
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <Badge variant="default" className="capitalize">
                  {tenant.subscriptionPlan}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Theme</span>
                <Badge variant="secondary">{brandLabel}</Badge>
              </div>
              {tenant.logoUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Logo</span>
                  <div className="size-8 overflow-hidden rounded-md border">
                    <img
                      src={tenant.logoUrl}
                      alt="Logo"
                      className="size-full object-contain p-0.5"
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(tenant.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{new Date(tenant.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
