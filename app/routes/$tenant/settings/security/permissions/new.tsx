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
import { createPermission } from "~/services/permissions.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { invariantResponse } from "~/utils/invariant";
import { buildServiceContext } from "~/utils/request-context.server";
import { createPermissionSchema } from "~/utils/schemas/security";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "New permission" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, "permission", "create");
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, "permission", "create");
  const tenantId = actor.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: createPermissionSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, actor, tenantId);
  try {
    const created = await createPermission(submission.value, ctx);
    return redirect(`/${params.tenant}/settings/security/permissions/${created.id}`);
  } catch (error) {
    return data(
      submission.reply({
        formErrors: [error instanceof Error ? error.message : "Failed to create permission"],
      }),
      { status: 400 },
    );
  }
}

export default function NewPermissionPage({ actionData, params }: Route.ComponentProps) {
  const { form, fields } = useForm(createPermissionSchema, {
    lastResult: actionData,
    defaultValue: { resource: "", action: "", module: "system", description: "" },
  });
  const backTo = `/${params.tenant}/settings/security/permissions`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">New permission</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Define a resource/action pair that roles can grant.
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
                  placeholder="e.g., user"
                />
                {fields.resource.errors && <FieldError>{fields.resource.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.action.id}>Action</FieldLabel>
                <Input
                  {...getInputProps(fields.action, { type: "text" })}
                  key={fields.action.key}
                  placeholder="e.g., create"
                />
                {fields.action.errors && <FieldError>{fields.action.errors}</FieldError>}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={fields.module.id}>Module</FieldLabel>
              <Input
                {...getInputProps(fields.module, { type: "text" })}
                key={fields.module.key}
                placeholder="e.g., settings"
              />
              {fields.module.errors && <FieldError>{fields.module.errors}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={fields.description.id}>Description</FieldLabel>
              <Textarea
                name={fields.description.name}
                id={fields.description.id}
                defaultValue={fields.description.initialValue ?? ""}
                rows={3}
                placeholder="What does this permission allow?"
              />
              {fields.description.errors && <FieldError>{fields.description.errors}</FieldError>}
            </Field>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Create permission</Button>
          <Button variant="outline" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
