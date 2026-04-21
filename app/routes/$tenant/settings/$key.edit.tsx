import type { FieldMetadata } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { CheckboxField, getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { StatusButton } from "~/components/ui/status-button";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { getSettingDefinition, SETTINGS_REGISTRY } from "~/utils/config/settings-registry";
import { getSetting, setSetting } from "~/utils/config/settings.server";
import { useIsPending } from "~/utils/misc";
import { buildServiceContext } from "~/utils/request-context.server";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/$key.edit";

export const handle = { breadcrumb: "Edit" };

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Edit ${decodeURIComponent(params.key)}` }];
}

const EditSchema = z.object({
  value: z.string(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  const user = await requirePermission(request, "settings", "read");
  const key = decodeURIComponent(params.key);

  const def = getSettingDefinition(key);
  if (!def) {
    throw data({ error: `Unknown setting "${key}"` }, { status: 404 });
  }

  const current = await getSetting(key, { userId: user.id, tenantId: tenant.id });
  return data({
    key,
    definition: def,
    currentValue: current?.value ?? def.defaultValue,
    currentScope: current?.scope ?? "default",
    tenantSlug: tenant.slug,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const tenant = await resolveTenant(params.tenant);
  const user = await requirePermission(request, "settings", "write");
  const key = decodeURIComponent(params.key);

  const def = getSettingDefinition(key);
  if (!def) {
    throw data({ error: `Unknown setting "${key}"` }, { status: 404 });
  }

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: EditSchema });
  if (submission.status !== "success") {
    return data({ result: submission.reply() }, { status: 400 });
  }

  const value = normaliseForType(def.type, submission.value.value);
  const validation = validateForType(def.type, value, def.options);
  if (validation) {
    return data(
      { result: submission.reply({ fieldErrors: { value: [validation] } }) },
      { status: 400 },
    );
  }

  const ctx = buildServiceContext(request, user, tenant.id);
  await setSetting(
    {
      key,
      value,
      type: def.type === "select" ? "string" : def.type,
      category: def.category,
      scope: "tenant",
      scopeId: tenant.id,
    },
    ctx,
  );

  return redirect(`/${tenant.slug}/settings`);
}

export default function EditSettingRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { key, definition, currentValue, currentScope, tenantSlug } = loaderData;

  const { form, fields } = useForm(EditSchema, {
    id: `setting-${key}-form`,
    defaultValue: { value: currentValue },
    lastResult: actionData?.result,
  });

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{definition.label}</CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 text-muted-foreground mb-4 rounded border px-3 py-2 text-xs">
            {t("currentValueLabel")} (<span className="font-mono">{currentScope}</span>):{" "}
            <code className="font-mono">{currentValue}</code>
            <br />
            {t("defaultValueLabel")}: <code className="font-mono">{definition.defaultValue}</code>
          </div>
          <Form method="POST" {...getFormProps(form)}>
            <AuthenticityTokenInput />
            <FieldGroup>
              {renderInput(definition, fields.value)}
              <ErrorList errors={form.errors} id={form.errorId} />
              <div className="flex flex-col gap-3 sm:flex-row">
                <StatusButton
                  className="w-full sm:w-auto"
                  status={isPending ? "pending" : (form.status ?? "idle")}
                  type="submit"
                  disabled={isPending}
                >
                  {tCommon("save")}
                </StatusButton>
                <Link
                  to={`/${tenantSlug}/settings`}
                  className="hover:bg-muted/60 inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm"
                >
                  {tCommon("cancel")}
                </Link>
              </div>
            </FieldGroup>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

function renderInput(def: (typeof SETTINGS_REGISTRY)[number], field: FieldMetadata<string>) {
  if (def.type === "boolean") {
    return (
      <Field>
        <div className="flex items-center gap-2">
          <CheckboxField meta={field} />
          <Label htmlFor={field.id} className="cursor-pointer text-sm">
            {def.label}
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">Check to enable, uncheck to disable.</p>
        {field.errors && <FieldError>{field.errors}</FieldError>}
      </Field>
    );
  }
  const inputType = def.type === "number" ? "number" : "text";
  return (
    <Field>
      <FieldLabel htmlFor={field.id}>{def.label}</FieldLabel>
      <Input {...getInputProps(field, { type: inputType })} key={field.key} />
      {field.errors && <FieldError>{field.errors}</FieldError>}
    </Field>
  );
}

function normaliseForType(type: string, raw: string): string {
  if (type === "boolean") {
    return raw === "on" || raw === "true" ? "true" : "false";
  }
  return raw;
}

function validateForType(
  type: string,
  value: string,
  options?: Array<{ value: string }>,
): string | null {
  if (type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) {
    return "Must be a number";
  }
  if (type === "select" && options && !options.some((o) => o.value === value)) {
    return `Must be one of: ${options.map((o) => o.value).join(", ")}`;
  }
  return null;
}
