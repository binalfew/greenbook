import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { getPermissionDetail, updatePermission } from "~/services/permissions.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import { updatePermissionSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit permission" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "permission", "update");
  const permission = await getPermissionDetail(params.permissionId);
  if (!permission) throw data({ error: "Permission not found" }, { status: 404 });
  return data({ permission });
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "permission", "update");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: updatePermissionSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, actor, tenantId);
  try {
    await updatePermission(params.permissionId, submission.value, ctx);
    return redirect(`/${params.tenant}/settings/security/permissions/${params.permissionId}`);
  } catch (error) {
    return data(
      submission.reply({
        formErrors: [error instanceof Error ? error.message : "Failed to update permission"],
      }),
      { status: 400 },
    );
  }
}

export default function EditPermissionPage({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { permission } = loaderData;
  const { form, fields } = useForm(updatePermissionSchema, {
    lastResult: actionData,
    defaultValue: {
      resource: permission.resource,
      action: permission.action,
      module: permission.module,
      description: permission.description ?? "",
    },
  });
  const backTo = `/${params.tenant}/settings/security/permissions/${permission.id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Edit permission</h2>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {permission.resource}:{permission.action}
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
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.resource.id}>Resource</FieldLabel>
                <Input
                  {...getInputProps(fields.resource, { type: "text" })}
                  key={fields.resource.key}
                />
                {fields.resource.errors && <FieldError>{fields.resource.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.action.id}>Action</FieldLabel>
                <Input
                  {...getInputProps(fields.action, { type: "text" })}
                  key={fields.action.key}
                />
                {fields.action.errors && <FieldError>{fields.action.errors}</FieldError>}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={fields.module.id}>Module</FieldLabel>
              <Input {...getInputProps(fields.module, { type: "text" })} key={fields.module.key} />
              {fields.module.errors && <FieldError>{fields.module.errors}</FieldError>}
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
