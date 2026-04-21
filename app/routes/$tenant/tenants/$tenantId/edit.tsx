import { parseWithZod } from "@conform-to/zod/v4";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { BrandingColorSection } from "~/components/branding-color-picker";
import { SelectField, getFormProps, getInputProps, useForm } from "~/components/form";
import { LogoUpload } from "~/components/logo-upload";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { getTenantById, updateTenant } from "~/services/tenants.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { PLAN_OPTIONS, updateTenantSchema } from "~/utils/schemas/tenant";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.tenant?.name ? `Edit · ${data.tenant.name}` : "Edit tenant" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "tenant", "update");
  const tenant = await getTenantById(params.tenantId);
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }
  return data({ tenant });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "tenant", "update");

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: updateTenantSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, params.tenantId);
  await updateTenant(params.tenantId, submission.value, ctx);

  return redirect(`/${params.tenant}/tenants/${params.tenantId}`);
}

export default function EditTenantPage({ loaderData, actionData }: Route.ComponentProps) {
  const { tenant } = loaderData;
  const basePrefix = useBasePrefix();

  const { form, fields } = useForm(updateTenantSchema, {
    lastResult: actionData,
    defaultValue: {
      name: tenant.name,
      slug: tenant.slug,
      email: tenant.email,
      phone: tenant.phone,
      address: tenant.address ?? "",
      city: tenant.city ?? "",
      state: tenant.state ?? "",
      subscriptionPlan: tenant.subscriptionPlan,
      logoUrl: tenant.logoUrl ?? "",
      brandTheme: tenant.brandTheme ?? "",
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Edit tenant</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Update {tenant.name}&apos;s profile, subscription, and branding.
        </p>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-6">
        <AuthenticityTokenInput />

        {form.errors && form.errors.length > 0 && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {form.errors.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor={fields.name.id}>Name</FieldLabel>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
              {fields.name.errors && <FieldError>{fields.name.errors}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor={fields.slug.id}>URL slug</FieldLabel>
              <Input {...getInputProps(fields.slug, { type: "text" })} key={fields.slug.key} />
              {fields.slug.errors && <FieldError>{fields.slug.errors}</FieldError>}
              <p className="text-muted-foreground mt-1 text-xs">
                Changing the slug will break existing tenant URLs.
              </p>
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.email.id}>Email</FieldLabel>
                <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
                {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.phone.id}>Phone</FieldLabel>
                <Input {...getInputProps(fields.phone, { type: "tel" })} key={fields.phone.key} />
                {fields.phone.errors && <FieldError>{fields.phone.errors}</FieldError>}
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor={fields.address.id}>Street address</FieldLabel>
              <Input
                {...getInputProps(fields.address, { type: "text" })}
                key={fields.address.key}
              />
              {fields.address.errors && <FieldError>{fields.address.errors}</FieldError>}
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.city.id}>City</FieldLabel>
                <Input {...getInputProps(fields.city, { type: "text" })} key={fields.city.key} />
                {fields.city.errors && <FieldError>{fields.city.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.state.id}>State</FieldLabel>
                <Input {...getInputProps(fields.state, { type: "text" })} key={fields.state.key} />
                {fields.state.errors && <FieldError>{fields.state.errors}</FieldError>}
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={fields.subscriptionPlan.id}>Plan</FieldLabel>
              <SelectField
                meta={fields.subscriptionPlan}
                options={PLAN_OPTIONS}
                placeholder="Select plan"
              />
              {fields.subscriptionPlan.errors && (
                <FieldError>{fields.subscriptionPlan.errors}</FieldError>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <LogoUpload initialLogoUrl={tenant.logoUrl} />
            <BrandingColorSection initialBrandTheme={tenant.brandTheme ?? ""} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Save changes</Button>
          <Button type="button" variant="outline" asChild>
            <Link to={`${basePrefix}/tenants/${tenant.id}`}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
