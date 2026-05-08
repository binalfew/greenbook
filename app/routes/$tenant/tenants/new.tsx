import { parseWithZod } from "@conform-to/zod/v4";
import { useEffect, useRef, useState } from "react";
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
import { createTenant } from "~/services/tenants.server";
import { requireGlobalAdmin } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { PLAN_OPTIONS, createTenantSchema } from "~/utils/schemas/tenant";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New Tenant" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "New tenant" }];
}

// Tenant management is global-admin-only (policy).
export async function loader({ request }: Route.LoaderArgs) {
  await requireGlobalAdmin(request);
  // Tenantless ("regular") users are eligible to be promoted as the new
  // tenant's first admin. Filtering to tenantless avoids accidentally moving
  // an existing tenant admin away from their current tenant via this form.
  const eligibleAdmins = await prisma.user.findMany({
    where: { tenantId: null, deletedAt: null },
    select: { id: true, email: true, firstName: true, lastName: true },
    orderBy: [{ email: "asc" }],
  });
  return data({ eligibleAdmins });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireGlobalAdmin(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: createTenantSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user);
  await createTenant(
    {
      ...submission.value,
      address: submission.value.address ?? "",
      city: submission.value.city ?? "",
      state: submission.value.state ?? "",
      initialAdminUserId: submission.value.initialAdminUserId,
    },
    ctx,
  );

  return redirect(`/${params.tenant}/tenants`);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function NewTenantPage({ loaderData, actionData }: Route.ComponentProps) {
  const { eligibleAdmins } = loaderData;
  const basePrefix = useBasePrefix();
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const slugInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [slugPreview, setSlugPreview] = useState("");

  const { form, fields } = useForm(createTenantSchema, {
    lastResult: actionData,
  });

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (slugManuallyEdited) return;
    const value = e.target.value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const generated = slugify(value);
      setSlugPreview(generated);
      if (slugInputRef.current) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeInputValueSetter?.call(slugInputRef.current, generated);
        slugInputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, 300);
  }

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Create tenant</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Add a new organization to the platform.
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
              <Input
                {...getInputProps(fields.name, { type: "text" })}
                key={fields.name.key}
                onChange={handleNameChange}
              />
              {fields.name.errors && <FieldError>{fields.name.errors}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor={fields.slug.id}>URL slug</FieldLabel>
              <Input
                {...getInputProps(fields.slug, { type: "text" })}
                key={fields.slug.key}
                ref={slugInputRef}
                placeholder="e.g. acme-corp"
                onChange={() => setSlugManuallyEdited(true)}
              />
              {fields.slug.errors && <FieldError>{fields.slug.errors}</FieldError>}
              <p className="text-muted-foreground mt-1 text-xs">
                URL preview:{" "}
                <code className="bg-muted rounded px-1.5 py-0.5">
                  /{slugPreview || fields.slug.defaultValue || "slug"}
                </code>
              </p>
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.email.id}>Email</FieldLabel>
                <Input
                  {...getInputProps(fields.email, { type: "email" })}
                  key={fields.email.key}
                  placeholder="admin@example.com"
                />
                {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.phone.id}>Phone</FieldLabel>
                <Input
                  {...getInputProps(fields.phone, { type: "tel" })}
                  key={fields.phone.key}
                  placeholder="+1-000-000-0000"
                />
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
                placeholder="123 Main St"
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
          <CardContent className="space-y-4">
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
            <CardTitle>Initial manager</CardTitle>
            <p className="text-muted-foreground text-sm">
              Optionally attach a tenantless user as this tenant's first manager (approves directory
              submissions and manages users within the tenant). Leave empty to create the tenant
              unattached — you can grant the manager role later via the user-edit form.
            </p>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={fields.initialAdminUserId.id}>User</FieldLabel>
              <SelectField
                meta={fields.initialAdminUserId}
                options={[
                  { value: "", label: "— None (assign later) —" },
                  ...eligibleAdmins.map((u) => ({
                    value: u.id,
                    label: `${u.firstName} ${u.lastName} (${u.email})`,
                  })),
                ]}
                placeholder="Select user"
              />
              {fields.initialAdminUserId.errors && (
                <FieldError>{fields.initialAdminUserId.errors}</FieldError>
              )}
              {eligibleAdmins.length === 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  No tenantless users available. Create a regular user first, or leave this empty
                  and promote someone later.
                </p>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <LogoUpload />
            <BrandingColorSection />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Create tenant</Button>
          <Button type="button" variant="outline" asChild>
            <Link to={`${basePrefix}/tenants`}>Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
