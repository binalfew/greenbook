import { useMemo } from "react";
import { data, useRouteLoaderData } from "react-router";
import { ModuleGrid } from "~/components/dashboard/module-grid";
import { getVisibleGroups, type Permission } from "~/config/navigation";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  return data({ tenant: { name: tenant.name, slug: tenant.slug } });
}

type LayoutData = {
  permissions: Permission[];
  enabledFeatures: Record<string, boolean>;
};

export default function TenantDashboard({ params }: Route.ComponentProps) {
  const layoutData = useRouteLoaderData("routes/$tenant/_layout") as LayoutData | undefined;
  const basePrefix = `/${params.tenant}`;
  const permissions = layoutData?.permissions ?? [];
  const enabledFeatures = layoutData?.enabledFeatures;
  const navGroups = useMemo(
    () => getVisibleGroups(permissions, basePrefix, enabledFeatures),
    [permissions, basePrefix, enabledFeatures],
  );

  return <ModuleGrid groups={navGroups} hideUrl={basePrefix} />;
}
