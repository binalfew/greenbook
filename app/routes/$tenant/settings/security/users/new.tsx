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
import { createUser } from "~/services/users.server";
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

  const [statuses, roles] = await Promise.all([
    prisma.userStatus.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { order: "asc" },
    }),
    prisma.role.findMany({
      where: { OR: [{ tenantId }, { scope: "GLOBAL" }] },
      select: { id: true, name: true, scope: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return data({ statuses, roles });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "user", "create");
  const tenantId = user.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: createUserSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const roleIds = formData.getAll("roleIds").filter((v): v is string => typeof v === "string");

  const ctx = buildServiceContext(request, user, tenantId);
  try {
    const created = await createUser({ ...submission.value, roleIds }, ctx);
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
  const { statuses, roles } = loaderData;

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
