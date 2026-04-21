import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { getFormProps, getInputProps, SelectField, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { getRoleDetail, updateRole } from "~/services/roles.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import { updateRoleSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit role" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "role", "update");
  const role = await getRoleDetail(params.roleId);
  if (!role) throw data({ error: "Role not found" }, { status: 404 });
  return data({ role });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "role", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: updateRoleSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, actor, tenantId);
  await updateRole(params.roleId, submission.value, ctx);

  return redirect(`/${params.tenant}/settings/security/roles/${params.roleId}`);
}

const SCOPE_OPTIONS = [
  { value: "TENANT", label: "Tenant" },
  { value: "GLOBAL", label: "Global" },
  { value: "EVENT", label: "Event" },
];

export default function EditRolePage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { role } = loaderData;
  const { form, fields } = useForm(updateRoleSchema, {
    lastResult: actionData,
    defaultValue: {
      name: role.name,
      description: role.description ?? "",
      scope: role.scope,
    },
  });
  const backTo = `/${params.tenant}/settings/security/roles/${role.id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Edit role</h2>
          <p className="text-muted-foreground mt-1 text-sm">{role.name}</p>
        </div>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-6">
        <AuthenticityTokenInput />

        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor={fields.name.id}>Name</FieldLabel>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
              {fields.name.errors && <FieldError>{fields.name.errors}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={fields.description.id}>Description</FieldLabel>
              <Textarea
                name={fields.description.name}
                id={fields.description.id}
                defaultValue={fields.description.initialValue ?? ""}
                rows={3}
              />
              {fields.description.errors && <FieldError>{fields.description.errors}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={fields.scope.id}>Scope</FieldLabel>
              <SelectField meta={fields.scope} options={SCOPE_OPTIONS} placeholder="Select scope" />
              {fields.scope.errors && <FieldError>{fields.scope.errors}</FieldError>}
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
