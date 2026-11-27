import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft, Mail } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { RoleScope } from "~/generated/prisma/client";
import { createInvitation } from "~/services/invitations.server";
import { SystemTenantRoleError } from "~/services/users.server";
import { requireTenantPermission } from "~/utils/acting-tenant.server";
import { assertCanGrantRoles } from "~/utils/auth/user-access.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { SYSTEM_TENANT_SLUG } from "~/utils/system-tenant";
import { buildServiceContext } from "~/utils/request-context.server";
import { inviteUserSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/invite";

export const handle = { breadcrumb: "Invite" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Invite user" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { isGlobalAdmin } = await requireTenantPermission(request, "user", "create");

  // The invited user joins the tenant in the URL. Tenant roles cannot be held
  // in the system tenant, and only a platform admin grants the others.
  const scopes = [
    ...(params.tenant === SYSTEM_TENANT_SLUG ? [] : [RoleScope.TENANT]),
    ...(isGlobalAdmin ? [RoleScope.GLOBAL] : []),
  ];
  const roles = await prisma.role.findMany({
    where: { scope: { in: scopes } },
    select: { id: true, name: true, scope: true },
    orderBy: { name: "asc" },
  });

  return data({ roles });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, tenantId } = await requireTenantPermission(request, "user", "create");

  const formData = await request.formData();
  const roleIds = formData.getAll("roleIds").filter((v): v is string => typeof v === "string");
  await assertCanGrantRoles(user, roleIds);
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: inviteUserSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  try {
    await createInvitation({ email: submission.value.email, roleIds }, ctx);
  } catch (error) {
    if (error instanceof SystemTenantRoleError) {
      return data(submission.reply({ formErrors: [error.message] }), { status: 400 });
    }
    throw error;
  }

  return redirect(`/${params.tenant}/settings/security/users`);
}

export default function InviteUserPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { roles } = loaderData;
  const { form, fields } = useForm(inviteUserSchema, { lastResult: actionData });
  const backTo = `/${params.tenant}/settings/security/users`;

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
            <Mail className="size-6" />
            Invite user
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Send an email invitation with a signup link that expires in 7 days.
          </p>
        </div>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-6">
        <AuthenticityTokenInput />

        {form.errors && form.errors.length > 0 && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {form.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recipient</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={fields.email.id}>Email</FieldLabel>
              <Input
                {...getInputProps(fields.email, { type: "email" })}
                key={fields.email.key}
                placeholder="user@example.com"
              />
              {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            {roles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No roles defined yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <label
                    key={r.id}
                    className="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <Checkbox name="roleIds" value={r.id} className="mt-0.5" />
                    <div>
                      <span className="font-medium">{r.name}</span>
                      <p className="text-muted-foreground mt-0.5 text-xs">{r.scope}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Send invitation</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
