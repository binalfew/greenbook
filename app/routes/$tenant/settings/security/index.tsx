import { ChevronRight, KeyRound, Link2, Shield, Smartphone, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, data } from "react-router";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { twoFAVerificationType } from "~/utils/auth/constants";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Security" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Security" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "user", "read");
  const tenantId = user.tenantId;

  const userWhere = tenantId ? { tenantId, deletedAt: null } : { deletedAt: null };
  const roleWhere = tenantId ? { OR: [{ tenantId }, { scope: "GLOBAL" as const }] } : {};

  const [userCount, roleCount, permissionCount, ssoCount] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.role.count({ where: roleWhere }),
    prisma.permission.count(),
    tenantId ? prisma.sSOConfiguration.count({ where: { tenantId } }) : 0,
  ]);

  // 2FA-enabled user count: Verification rows with type "2fa" whose `target`
  // matches a user in this tenant. Two-step so we don't leak cross-tenant
  // verifications into the count.
  const tenantUserIds = tenantId
    ? await prisma.user
        .findMany({ where: { tenantId, deletedAt: null }, select: { id: true } })
        .then((rows) => rows.map((r) => r.id))
    : [];
  const twoFactorCount =
    tenantUserIds.length > 0
      ? await prisma.verification.count({
          where: { type: twoFAVerificationType, target: { in: tenantUserIds } },
        })
      : 0;

  return data({
    counts: {
      users: userCount,
      roles: roleCount,
      permissions: permissionCount,
      sso: ssoCount,
      twofactor: twoFactorCount,
    },
  });
}

function SurfaceCard({
  icon: Icon,
  title,
  value,
  description,
  to,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  value: string | number;
  description: string;
  to: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="group bg-card hover:border-primary/40 relative flex items-start gap-4 rounded-xl border p-4 transition-all hover:shadow-md"
    >
      <div
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs font-medium tabular-nums">{value}</p>
        </div>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{description}</p>
      </div>
      <ChevronRight className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export default function SecurityHubPage({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;
  const basePrefix = useBasePrefix();
  const basePath = `${basePrefix}/settings/security`;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-foreground text-2xl font-bold tracking-tight">Security</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage access control, authentication, and user permissions for your organization.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Manage
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SurfaceCard
            icon={Users}
            title="Users"
            value={counts.users}
            description="Create accounts, manage credentials, and assign roles."
            to={`${basePath}/users`}
            accent="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          />
          <SurfaceCard
            icon={Shield}
            title="Roles"
            value={counts.roles}
            description="Define access levels with scoped permission sets."
            to={`${basePath}/roles`}
            accent="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          />
          <SurfaceCard
            icon={KeyRound}
            title="Permissions"
            value={counts.permissions}
            description="Resource-action pairs that control what each role can do."
            to={`${basePath}/permissions`}
            accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <SurfaceCard
            icon={Link2}
            title="SSO providers"
            value={counts.sso}
            description="Connect OIDC, SAML, Azure AD, or Google for single sign-on."
            to={`${basePath}/sso`}
            accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
          <SurfaceCard
            icon={Smartphone}
            title="Two-factor auth"
            value={counts.twofactor}
            description="TOTP-based second factor. Enroll users and enforce policy."
            to={`${basePath}/twofactor`}
            accent="bg-rose-500/10 text-rose-600 dark:text-rose-400"
          />
        </div>
      </div>
    </div>
  );
}
