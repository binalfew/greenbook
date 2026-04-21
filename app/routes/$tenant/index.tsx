import { useMemo } from "react";
import { data, useRouteLoaderData } from "react-router";
import { ModuleGrid } from "~/components/dashboard/module-grid";
import { getVisibleGroups, type Permission } from "~/config/navigation";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Dashboard" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  return data({ tenant: { name: tenant.name, slug: tenant.slug } });
}

type LayoutData = {
  user: { firstName?: string; lastName?: string };
  permissions: Permission[];
  enabledFeatures: Record<string, boolean>;
};

export default function TenantDashboard({ loaderData, params }: Route.ComponentProps) {
  const layoutData = useRouteLoaderData("routes/$tenant/_layout") as LayoutData | undefined;
  const basePrefix = `/${params.tenant}`;
  const permissions = layoutData?.permissions ?? [];
  const enabledFeatures = layoutData?.enabledFeatures;
  const navGroups = useMemo(
    () => getVisibleGroups(permissions, basePrefix, enabledFeatures),
    [permissions, basePrefix, enabledFeatures],
  );
  const firstName = layoutData?.user?.firstName;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
          {firstName ? `Welcome back, ${firstName}.` : `Welcome to ${loaderData.tenant.name}.`}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your launchpad for every tool in this workspace.
        </p>
      </div>

      <ModuleGrid groups={navGroups} hideUrl={basePrefix} />
    </div>
  );
}
