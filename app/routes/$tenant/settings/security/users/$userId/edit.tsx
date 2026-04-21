import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { getFormProps, getInputProps, SelectField, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { getUserDetail, updateUser } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import { updateUserSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit user" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "user", "update");
  const [user, statuses] = await Promise.all([
    getUserDetail(params.userId),
    prisma.userStatus.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { order: "asc" },
    }),
  ]);
  if (!user) throw data({ error: "User not found" }, { status: 404 });
  return data({ user, statuses });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "user", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: updateUserSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, actor, tenantId);
  await updateUser(params.userId, submission.value, ctx);

  return redirect(`/${params.tenant}/settings/security/users/${params.userId}`);
}

export default function EditUserPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { user, statuses } = loaderData;
  const { form, fields } = useForm(updateUserSchema, {
    lastResult: actionData,
    defaultValue: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      userStatusId: user.userStatus?.id ?? "",
    },
  });
  const backTo = `/${params.tenant}/settings/security/users/${user.id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Edit user</h2>
          <p className="text-muted-foreground mt-1 text-sm">{user.email}</p>
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
            <CardTitle>Profile</CardTitle>
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

        <div className="flex gap-3">
          <Button type="submit">Save changes</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
