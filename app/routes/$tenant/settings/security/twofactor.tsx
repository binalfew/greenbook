import {
  AlertTriangle,
  ArrowLeft,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Users,
} from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { listRolesPaginated } from "~/services/roles.server";
import { getTwoFAPolicy } from "~/services/two-factor.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { twoFAVerificationType } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { FEATURE_FLAG_KEYS } from "~/utils/config/feature-flag-keys";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { setSetting } from "~/utils/config/settings.server";
import { prisma } from "~/utils/db/db.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/twofactor";

export const handle = { breadcrumb: "Two-factor auth" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Two-factor authentication" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, "two-factor", "read");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "User is not associated with a tenant", { status: 403 });

  const roles = actor.roles?.map((r) => r.name) ?? [];

  const [twoFactorEnabled, policy, { items: tenantRoles }, tenantUsers, totalUsers] =
    await Promise.all([
      isFeatureEnabled(FEATURE_FLAG_KEYS.TWO_FACTOR, { tenantId, roles, userId: actor.id }),
      getTwoFAPolicy(tenantId),
      listRolesPaginated(tenantId, { page: 1, pageSize: 500 }),
      prisma.user.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true },
      }),
      prisma.user.count({ where: { tenantId, deletedAt: null } }),
    ]);

  const tenantUserIds = tenantUsers.map((u) => u.id);
  const enabledUsers =
    tenantUserIds.length === 0
      ? 0
      : await prisma.verification.count({
          where: { type: twoFAVerificationType, target: { in: tenantUserIds } },
        });

  return data({ twoFactorEnabled, policy, tenantRoles, enabledUsers, totalUsers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "two-factor", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "User is not associated with a tenant", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const mode = formData.get("mode");
  let value = "off";
  if (mode === "all") {
    value = "all";
  } else if (mode === "roles") {
    const selectedRoles = formData
      .getAll("roleIds")
      .filter((v): v is string => typeof v === "string");
    if (selectedRoles.length > 0) {
      value = `roles:${selectedRoles.join(",")}`;
    }
  }

  const ctx = buildServiceContext(request, actor, tenantId);
  await setSetting(
    {
      key: "security.require2fa",
      value,
      type: "string",
      category: "auth",
      scope: "tenant",
      scopeId: tenantId,
    },
    ctx,
  );

  return redirect(`/${params.tenant}/settings/security/twofactor`);
}

const MODE_META: Record<
  string,
  { label: string; icon: typeof ShieldCheck; variant: "default" | "secondary" | "outline" }
> = {
  off: { label: "Optional", icon: ShieldOff, variant: "secondary" },
  all: { label: "All users", icon: ShieldCheck, variant: "default" },
  roles: { label: "Specific roles", icon: Shield, variant: "outline" },
};

export default function TwoFactorSettingsPage({ loaderData }: Route.ComponentProps) {
  const { twoFactorEnabled, policy, tenantRoles, enabledUsers, totalUsers } = loaderData;
  const basePrefix = useBasePrefix();
  const coverage = totalUsers > 0 ? Math.round((enabledUsers / totalUsers) * 100) : 0;
  const meta = MODE_META[policy.mode] ?? MODE_META.off;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`${basePrefix}/settings/security`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 flex size-12 items-center justify-center rounded-xl">
              <Smartphone className="text-primary size-6" />
            </div>
            <div>
              <h2 className="text-foreground text-2xl font-bold">Two-factor authentication</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Require TOTP-based verification for user logins.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">Enforcement</div>
          <div className="mt-1">
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Users className="size-3" />
            Users enrolled
          </div>
          <p className="mt-1 text-lg font-bold">
            {enabledUsers}/{totalUsers}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">Coverage</div>
          <p
            className={`mt-1 text-lg font-bold ${
              coverage >= 80
                ? "text-green-600"
                : coverage >= 50
                  ? "text-amber-600"
                  : "text-muted-foreground"
            }`}
          >
            {coverage}%
          </p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">Feature flag</div>
          <div className="mt-1">
            <Badge variant={twoFactorEnabled ? "default" : "secondary"}>
              {twoFactorEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </div>
      </div>

      {!twoFactorEnabled && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Feature flag required
            </p>
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-300">
              The FF_TWO_FACTOR feature flag must be enabled before enforcement policies take
              effect. Turn it on in{" "}
              <Link
                to={`${basePrefix}/settings/features`}
                className="font-medium underline underline-offset-2"
              >
                Features
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <Form method="post" className="space-y-6">
        <AuthenticityTokenInput />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Enforcement mode</h3>
          <RadioGroup name="mode" defaultValue={policy.mode} className="space-y-3">
            <label className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors">
              <RadioGroupItem value="off" className="mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Off</p>
                  <Badge variant="secondary" className="text-[10px]">
                    Optional
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Two-factor is available but not required. Users can enable it from their profile.
                </p>
              </div>
            </label>

            <label className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors">
              <RadioGroupItem value="all" className="mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">All users</p>
                  <Badge variant="default" className="text-[10px]">
                    Recommended
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Every user must set up 2FA. Those who haven&apos;t will be prompted on next login.
                </p>
              </div>
            </label>

            <label className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors">
              <RadioGroupItem value="roles" className="mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Specific roles</p>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Only users with selected roles must enable 2FA.
                </p>
              </div>
            </label>
          </RadioGroup>
        </section>

        {tenantRoles.length > 0 && (
          <section className="space-y-3">
            <Label asChild>
              <h3 className="text-sm font-semibold">
                Required for roles
                <span className="text-muted-foreground ml-1 font-normal">
                  (applies in &quot;Specific roles&quot; mode)
                </span>
              </h3>
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {tenantRoles.map((role) => (
                <label
                  key={role.id}
                  className="hover:bg-accent/50 has-[:checked]:border-primary/30 has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                >
                  <Checkbox
                    name="roleIds"
                    value={role.id}
                    defaultChecked={policy.roleIds.includes(role.id)}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{role.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {role._count.userRoles} {role._count.userRoles === 1 ? "user" : "users"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <Button type="submit" className="w-full sm:w-auto">
            Save policy
          </Button>
          <Button type="reset" variant="outline" className="w-full sm:w-auto">
            Reset
          </Button>
        </div>
      </Form>
    </div>
  );
}
