import { parseWithZod } from "@conform-to/zod/v4";
import { Building2, Mail, MapPin, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, Form, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { BrandingColorSection } from "~/components/branding-color-picker";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { LogoUpload } from "~/components/logo-upload";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { updateTenant } from "~/services/tenants.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { organizationSchema } from "~/utils/schemas/organization";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/organization";

export const handle = { breadcrumb: "Organization" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Organization" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, "settings", "read");
  const tenant = await resolveTenant(params.tenant);
  return data({ tenant });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "settings", "write");
  const tenant = await resolveTenant(params.tenant);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: organizationSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenant.id);
  await updateTenant(tenant.id, submission.value, ctx);

  return redirect(`/${params.tenant}/settings/organization`);
}

export default function OrganizationSettingsPage({ loaderData, actionData }: Route.ComponentProps) {
  useTranslation("common");
  const { tenant } = loaderData;

  const { form, fields } = useForm(organizationSchema, {
    lastResult: actionData,
    defaultValue: {
      name: tenant.name,
      email: tenant.email,
      phone: tenant.phone,
      address: tenant.address ?? "",
      city: tenant.city ?? "",
      state: tenant.state ?? "",
      logoUrl: tenant.logoUrl ?? "",
      brandTheme: tenant.brandTheme ?? "",
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 flex size-12 items-center justify-center rounded-xl">
          <Building2 className="text-primary size-6" />
        </div>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Organization</h2>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-muted-foreground text-sm">
              Manage your organization&apos;s profile and branding.
            </p>
            <Badge variant="outline" className="text-[10px]">
              {tenant.slug}
            </Badge>
          </div>
        </div>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-8">
        <AuthenticityTokenInput />

        {form.errors && form.errors.length > 0 && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {form.errors.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
          </div>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="text-muted-foreground size-4" />
            <h3 className="text-sm font-semibold">Contact Information</h3>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <Field>
              <FieldLabel htmlFor={fields.name.id}>Organization Name</FieldLabel>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
              {fields.name.errors && <FieldError>{fields.name.errors}</FieldError>}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="text-muted-foreground size-4" />
            <h3 className="text-sm font-semibold">Address</h3>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <Field>
              <FieldLabel htmlFor={fields.address.id}>Street Address</FieldLabel>
              <Input
                {...getInputProps(fields.address, { type: "text" })}
                key={fields.address.key}
              />
              {fields.address.errors && <FieldError>{fields.address.errors}</FieldError>}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Palette className="text-muted-foreground size-4" />
            <h3 className="text-sm font-semibold">Branding</h3>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <LogoUpload initialLogoUrl={tenant.logoUrl} />
            <BrandingColorSection initialBrandTheme={tenant.brandTheme ?? ""} />
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" className="w-full sm:w-auto">
            Save Changes
          </Button>
          <Button type="reset" variant="outline" className="w-full sm:w-auto">
            Reset
          </Button>
        </div>
      </Form>
    </div>
  );
}
