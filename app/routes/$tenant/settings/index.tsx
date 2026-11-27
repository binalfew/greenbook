import { parseWithZod } from "@conform-to/zod/v4";
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, LayoutList, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, Link, redirect, useLocation } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { updateTenant } from "~/services/tenants.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { getSettingCategories, getSettingDefinition } from "~/utils/config/settings-registry";
import { getAllSettings } from "~/utils/config/settings.server";
import type { LayoutMode } from "~/utils/layout-mode";
import { getLayoutMode } from "~/utils/layout-mode.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { contactInfoSchema } from "~/utils/schemas/organization";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

type LayoutOption = {
  value: LayoutMode;
  icon: LucideIcon;
  title: string;
  description: string;
};

const LAYOUT_OPTIONS: LayoutOption[] = [
  {
    value: "sidebar",
    icon: LayoutList,
    title: "Sidebar",
    description: "Collapsible sidebar with module navigation, plus top navbar.",
  },
  {
    value: "navbar",
    icon: LayoutDashboard,
    title: "Navbar only",
    description: "No sidebar. The menu sits in the top bar.",
  },
];

export const handle = { breadcrumb: "General" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  const user = await requirePermission(request, "settings", "read");

  const grouped = await getAllSettings({ userId: user.id, tenantId: tenant.id });
  const sortedCategories = getSettingCategories().filter((c) => grouped[c]?.length);

  return data({
    tenantSlug: tenant.slug,
    contact: { name: tenant.name, email: tenant.email, phone: tenant.phone },
    sortedCategories,
    grouped,
    layoutMode: getLayoutMode(request),
  });
}

/** Saves the tenant's contact info, the one form this page posts to itself. */
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "settings", "write");
  const tenant = await resolveTenant(params.tenant);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: contactInfoSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  await updateTenant(tenant.id, submission.value, buildServiceContext(request, user, tenant.id));

  return redirect(`/${params.tenant}/settings`);
}

export default function SettingsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { sortedCategories, grouped, tenantSlug, contact, layoutMode } = loaderData;
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const location = useLocation();
  const { form, fields } = useForm(contactInfoSchema, {
    lastResult: actionData,
    defaultValue: contact,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-lg">
              <LayoutDashboard className="text-primary size-4" />
            </div>
            <div>
              <CardTitle className="text-base">Preferences</CardTitle>
              <CardDescription>
                Personal settings stored in your browser. Applies to this device only.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form method="post" action="/resources/layout-mode" className="space-y-3">
            <input
              type="hidden"
              name="redirectTo"
              value={`${location.pathname}${location.search}`}
            />
            <div>
              <p className="text-sm font-medium">Layout</p>
              <p className="text-muted-foreground text-xs">
                Choose how the app chrome is arranged. Changes apply after saving.
              </p>
            </div>
            <RadioGroup
              name="mode"
              defaultValue={layoutMode}
              className="grid-cols-1 sm:grid-cols-2"
            >
              {LAYOUT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`layout-${opt.value}`}
                    className="border-border hover:bg-accent/40 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:ring-primary/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[[data-state=checked]]:ring-1"
                  >
                    <RadioGroupItem value={opt.value} id={`layout-${opt.value}`} className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="text-muted-foreground size-4" />
                        <span className="text-sm font-medium">{opt.title}</span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">{opt.description}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
            <Button type="submit" size="sm">
              Save preference
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-lg">
              <Mail className="text-primary size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t("contactInfoTitle")}</CardTitle>
              <CardDescription>{t("contactInfoHelp")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form method="post" {...getFormProps(form)} className="space-y-4">
            <AuthenticityTokenInput />

            {form.errors && form.errors.length > 0 && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {form.errors.map((error, i) => (
                  <p key={i}>{error}</p>
                ))}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor={fields.name.id}>{t("contactInfoName")}</FieldLabel>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
              {fields.name.errors && <FieldError>{fields.name.errors}</FieldError>}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.email.id}>{t("contactInfoEmail")}</FieldLabel>
                <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
                {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.phone.id}>{t("contactInfoPhone")}</FieldLabel>
                <Input {...getInputProps(fields.phone, { type: "tel" })} key={fields.phone.key} />
                {fields.phone.errors && <FieldError>{fields.phone.errors}</FieldError>}
              </Field>
            </div>

            <Button type="submit" size="sm">
              {tCommon("save")}
            </Button>
          </Form>
        </CardContent>
      </Card>

      {sortedCategories.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="capitalize">
              {t(`category_${category}`, { defaultValue: category })}
            </CardTitle>
            <CardDescription>{describeCategory(category)}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {grouped[category].map((s) => {
              const def = getSettingDefinition(s.key);
              return (
                <div
                  key={s.key}
                  className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{def?.label ?? s.key}</div>
                    <div className="text-muted-foreground text-sm">{def?.description ?? s.key}</div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t("resolvedFrom")} <span className="font-mono">{s.scope}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-3">
                    <code className="bg-muted max-w-[220px] truncate rounded px-2 py-1 text-xs">
                      {formatValue(s.type, s.value, tCommon)}
                    </code>
                    <Link
                      to={`/${tenantSlug}/settings/${encodeURIComponent(s.key)}/edit`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {tCommon("edit")}
                    </Link>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function describeCategory(category: string): string {
  switch (category) {
    case "i18n":
      return "Languages offered in the language switcher.";
    default:
      return "Settings for this category.";
  }
}

function formatValue(type: string, value: string, tCommon: (key: string) => string): string {
  if (type === "boolean") {
    return value === "true" ? tCommon("on") : tCommon("off");
  }
  return value;
}
