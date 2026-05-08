import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { getFormProps, getInputProps, SelectField, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { RoleScope } from "~/generated/prisma/client";
import { createUser, setUserTenantAssignment } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import { createUserSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "New user" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "user", "create");
  const tenantId = user.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });
  const isGlobalAdmin = user.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");

  const [statuses, roles, tenants] = await Promise.all([
    prisma.userStatus.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { order: "asc" },
    }),
    // Roles are global definitions (4 platform-wide rows). Managers see only
    // TENANT-scope roles (focal, manager); only platform admins can pick
    // GLOBAL roles (admin, user). Mirrors users/$userId/roles.tsx — closes
    // the GLOBAL-role self-elevation path.
    prisma.role.findMany({
      where: isGlobalAdmin ? {} : { scope: RoleScope.TENANT },
      select: { id: true, name: true, scope: true },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
    }),
    isGlobalAdmin
      ? prisma.tenant.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return data({ statuses, roles, tenants, isGlobalAdmin });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "user", "create");
  const tenantId = user.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });
  const isGlobalAdmin = user.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: createUserSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const roleIds = formData.getAll("roleIds").filter((v): v is string => typeof v === "string");

  // Defense in depth: managers can only assign TENANT-scope roles. Granting
  // GLOBAL roles (admin, user) is platform-admin-only. Same rule as
  // users/$userId/roles.tsx — rejects hand-crafted POSTs that smuggle in a
  // GLOBAL role id.
  if (roleIds.length > 0 && !isGlobalAdmin) {
    const submitted = await prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, scope: true },
    });
    const disallowed = submitted.filter((r) => r.scope !== RoleScope.TENANT);
    if (disallowed.length > 0) {
      throw data(
        {
          error: "Forbidden",
          message: "Only platform admins can grant GLOBAL-scope roles.",
        },
        { status: 403 },
      );
    }
  }

  // Strip the tenant override for non-global actors so a tenant admin can't
  // create users into other tenants by hand-crafting a POST.
  const { tenantId: targetTenantId, ...rest } = submission.value;
  const safeInput = isGlobalAdmin
    ? { ...rest, roleIds, tenantId: targetTenantId }
    : { ...rest, roleIds };

  const ctx = buildServiceContext(request, user, tenantId);
  try {
    const created = await createUser(safeInput, ctx);
    // When a global admin assigns the new user to a tenant, follow up with
    // the tenant-assignment helper so the user actually gets the tenant's
    // admin role + permissions (and the tenant gets bootstrapped if needed).
    // For tenant admins (not global), `targetTenantId` was stripped above so
    // the new user inherits ctx.tenantId from createUser; no role wiring here
    // — that's what the existing role-assignment UI is for.
    if (isGlobalAdmin && targetTenantId !== undefined && targetTenantId !== null) {
      await setUserTenantAssignment(created.id, targetTenantId, ctx);
    }
    return redirect(`/${params.tenant}/settings/security/users/${created.id}`);
  } catch (error) {
    return data(
      submission.reply({
        formErrors: [error instanceof Error ? error.message : "Failed to create user"],
      }),
      { status: 400 },
    );
  }
}

export default function NewUserPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { statuses, roles, tenants, isGlobalAdmin } = loaderData;

  const { form, fields } = useForm(createUserSchema, { lastResult: actionData });
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
          <h2 className="text-foreground text-2xl font-bold">New user</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Create an account with an initial password and optional role assignments.
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
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.firstName.id}>First name</FieldLabel>
                <Input
                  {...getInputProps(fields.firstName, { type: "text" })}
                  key={fields.firstName.key}
                />
                {fields.firstName.errors && <FieldError>{fields.firstName.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.lastName.id}>Last name</FieldLabel>
                <Input
                  {...getInputProps(fields.lastName, { type: "text" })}
                  key={fields.lastName.key}
                />
                {fields.lastName.errors && <FieldError>{fields.lastName.errors}</FieldError>}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={fields.email.id}>Email</FieldLabel>
              <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
              {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={fields.userStatusId.id}>Status</FieldLabel>
              <SelectField
                meta={fields.userStatusId}
                options={statuses.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Select status"
              />
              {fields.userStatusId.errors && <FieldError>{fields.userStatusId.errors}</FieldError>}
            </Field>
          </CardContent>
        </Card>

        {isGlobalAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Tenant assignment</CardTitle>
              <p className="text-muted-foreground text-sm">
                Set the user's home tenant. This sets only their tenant binding — pick role grants
                (focal / manager) below or via the Roles page after creation. Leave unassigned to
                create a regular (search-only) user.
              </p>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel htmlFor={fields.tenantId.id}>Tenant</FieldLabel>
                <SelectField
                  meta={fields.tenantId}
                  options={[
                    { value: "", label: "— None (regular user) —" },
                    ...tenants.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` })),
                  ]}
                  placeholder="Select tenant"
                />
                {fields.tenantId.errors && <FieldError>{fields.tenantId.errors}</FieldError>}
              </Field>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Initial password</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={fields.password.id}>Password</FieldLabel>
              <Input
                {...getInputProps(fields.password, { type: "password" })}
                key={fields.password.key}
                autoComplete="new-password"
              />
              {fields.password.errors && <FieldError>{fields.password.errors}</FieldError>}
              <p className="text-muted-foreground mt-1 text-xs">
                Minimum 8 characters, at least one upper, lower, and a digit.
              </p>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent>
            {roles.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No roles defined yet. Add some via Settings → Security → Roles.
              </p>
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
          <Button type="submit">Create user</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
