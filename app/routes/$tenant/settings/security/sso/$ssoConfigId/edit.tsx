import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import {
  CheckboxField,
  SelectField,
  getFormProps,
  getInputProps,
  getTextareaProps,
  useForm,
} from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { getSSOConfigById, updateSSOConfiguration } from "~/services/sso.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { SSO_PROTOCOL_OPTIONS, SSO_PROVIDER_OPTIONS } from "~/utils/constants/sso";
import { prisma } from "~/utils/db/db.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { createSSOConfigSchema } from "~/utils/schemas/sso";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "sso", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const config = await getSSOConfigById(params.ssoConfigId);
  if (!config || config.tenantId !== tenantId) {
    throw data({ error: "SSO configuration not found" }, { status: 404 });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const callbackUrl = `${appUrl}/sso/callback`;
  const roles = await prisma.role.findMany({
    where: { OR: [{ tenantId }, { tenantId: null }], name: { not: "admin" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return data({ config, callbackUrl, roles });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "sso", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: createSSOConfigSchema });

  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  await updateSSOConfiguration(params.ssoConfigId, submission.value, ctx);
  return redirect(`/${params.tenant}/settings/security/sso/${params.ssoConfigId}`);
}

function FieldRow({
  id,
  label,
  required,
  errors,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {errors && errors.length > 0 && <p className="text-destructive text-sm">{errors[0]}</p>}
    </div>
  );
}

export default function EditSSOConfigPage({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { t } = useTranslation("sso");
  const { t: tc } = useTranslation("common");
  const { config, callbackUrl, roles } = loaderData;
  const base = `/${params.tenant}/settings/security/sso`;

  const { form, fields } = useForm(createSSOConfigSchema, {
    lastResult: actionData,
    defaultValue: {
      provider: config.provider,
      protocol: config.protocol,
      displayName: config.displayName ?? "",
      issuerUrl: config.issuerUrl ?? "",
      clientId: config.clientId ?? "",
      clientSecret: "",
      metadataUrl: config.metadataUrl ?? "",
      callbackUrl: config.callbackUrl,
      autoProvision: config.autoProvision ? "on" : "",
      enforceSSO: config.enforceSSO ? "on" : "",
      defaultRoleId: config.defaultRoleId ?? "",
      x509Certificate: config.x509Certificate ?? "",
      ssoUrl: config.ssoUrl ?? "",
      spEntityId: config.spEntityId ?? "",
      nameIdFormat: config.nameIdFormat ?? "",
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">{t("editProvider")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("editProviderSubtitle", { name: config.displayName || config.provider })}
        </p>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("general")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FieldRow
                id={fields.provider.id}
                label={t("provider")}
                required
                errors={fields.provider.errors}
              >
                <SelectField
                  meta={fields.provider}
                  options={[...SSO_PROVIDER_OPTIONS]}
                  placeholder={t("selectProvider")}
                />
              </FieldRow>
              <FieldRow
                id={fields.protocol.id}
                label={t("protocol")}
                required
                errors={fields.protocol.errors}
              >
                <SelectField
                  meta={fields.protocol}
                  options={[...SSO_PROTOCOL_OPTIONS]}
                  placeholder={t("selectProtocol")}
                />
              </FieldRow>
            </div>
            <FieldRow
              id={fields.displayName.id}
              label={t("displayName")}
              errors={fields.displayName.errors}
            >
              <Input
                {...getInputProps(fields.displayName, { type: "text" })}
                key={fields.displayName.key}
              />
            </FieldRow>
            <FieldRow
              id={fields.issuerUrl.id}
              label={t("issuerUrl")}
              errors={fields.issuerUrl.errors}
            >
              <Input
                {...getInputProps(fields.issuerUrl, { type: "url" })}
                key={fields.issuerUrl.key}
              />
            </FieldRow>
            <FieldRow
              id={fields.callbackUrl.id}
              label={t("callbackUrlLabel")}
              required
              errors={fields.callbackUrl.errors}
            >
              <Input
                {...getInputProps(fields.callbackUrl, { type: "url" })}
                key={fields.callbackUrl.key}
                placeholder={callbackUrl}
              />
            </FieldRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("oidcConfig")}</CardTitle>
            <CardDescription>{t("oidcConfigHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FieldRow
                id={fields.clientId.id}
                label={t("clientId")}
                errors={fields.clientId.errors}
              >
                <Input
                  {...getInputProps(fields.clientId, { type: "text" })}
                  key={fields.clientId.key}
                />
              </FieldRow>
              <FieldRow
                id={fields.clientSecret.id}
                label={t("clientSecret")}
                errors={fields.clientSecret.errors}
              >
                <Input
                  {...getInputProps(fields.clientSecret, { type: "password" })}
                  key={fields.clientSecret.key}
                  placeholder={t("clientSecretKeepExisting")}
                />
              </FieldRow>
            </div>
            <FieldRow
              id={fields.metadataUrl.id}
              label={t("metadataUrl")}
              errors={fields.metadataUrl.errors}
            >
              <Input
                {...getInputProps(fields.metadataUrl, { type: "url" })}
                key={fields.metadataUrl.key}
              />
            </FieldRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("samlConfig")}</CardTitle>
            <CardDescription>{t("samlConfigHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldRow id={fields.ssoUrl.id} label={t("idpSsoUrl")} errors={fields.ssoUrl.errors}>
              <Input
                {...getInputProps(fields.ssoUrl, { type: "url" })}
                key={fields.ssoUrl.key}
                placeholder="https://your-idp.example.com/saml2/sso"
              />
            </FieldRow>
            <FieldRow
              id={fields.spEntityId.id}
              label={t("spEntityId")}
              errors={fields.spEntityId.errors}
            >
              <Input
                {...getInputProps(fields.spEntityId, { type: "text" })}
                key={fields.spEntityId.key}
                placeholder={callbackUrl.replace("/sso/callback", "")}
              />
            </FieldRow>
            <FieldRow
              id={fields.x509Certificate.id}
              label={t("x509Certificate")}
              errors={fields.x509Certificate.errors}
            >
              <Textarea
                {...getTextareaProps(fields.x509Certificate)}
                key={fields.x509Certificate.key}
                className="min-h-[120px] font-mono"
                placeholder={
                  "-----BEGIN CERTIFICATE-----\nMIIDdTCCAl2gAwIBAgI...\n-----END CERTIFICATE-----"
                }
              />
            </FieldRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("provisioning")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldRow
              id={fields.defaultRoleId.id}
              label={t("defaultRole")}
              errors={fields.defaultRoleId.errors}
            >
              <SelectField
                meta={fields.defaultRoleId}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
                placeholder={t("selectDefaultRole")}
              />
            </FieldRow>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckboxField meta={fields.autoProvision} />
                <label htmlFor={fields.autoProvision.id} className="cursor-pointer text-sm">
                  {t("autoProvisionLabel")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <CheckboxField meta={fields.enforceSSO} />
                <label htmlFor={fields.enforceSSO.id} className="cursor-pointer text-sm">
                  {t("enforceSsoLabel")}
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="w-full sm:w-auto">
            {tc("save")}
          </Button>
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <Link to={`${base}/${config.id}`}>{tc("cancel")}</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}
