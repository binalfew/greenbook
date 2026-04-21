import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import { Button } from "~/components/ui/button";
import { writeAudit } from "~/utils/auth/audit.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { requireUser } from "~/utils/auth/session.server";
import { useIsPending } from "~/utils/misc";
import { start2FASetup, verify2FASetup } from "~/services/two-factor.server";
import { generateRecoveryCodes } from "~/services/recovery-codes.server";
import type { Route } from "./+types/2fa-setup";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Set up two-factor authentication" },
    { name: "description", content: "Enable two-factor authentication for your account" },
  ];
}

export const TwoFASetupSchema = z.object({
  code: z
    .string({ error: "Code is required" })
    .trim()
    .min(6, { message: "Code must be at least 6 digits" })
    .max(8, { message: "Code is too long" }),
});

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const { qrCode, secret, issuer } = await start2FASetup(user.id, user.email, request);
  return data({ qrCode, secret, issuer, email: user.email });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = parseWithZod(formData, { schema: TwoFASetupSchema });
  if (submission.status !== "success") {
    return data({ result: submission.reply() }, { status: 400 });
  }

  const valid = await verify2FASetup(user.id, submission.value.code);
  if (!valid) {
    return data(
      {
        result: submission.reply({
          fieldErrors: { code: ["Invalid or expired code. Please try again."] },
        }),
      },
      { status: 400 },
    );
  }

  const recoveryCodes = await generateRecoveryCodes(user.id);

  await writeAudit({
    userId: user.id,
    action: "TWO_FACTOR_ENABLE",
    entityType: "user",
    entityId: user.id,
    description: `Two-factor authentication enabled for ${user.email}`,
    request,
  });

  return data({ recoveryCodes });
}

function hasRecoveryCodes(
  actionData: Route.ComponentProps["actionData"],
): actionData is { recoveryCodes: string[] } {
  return !!actionData && "recoveryCodes" in actionData && Array.isArray(actionData.recoveryCodes);
}

export default function TwoFASetupRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");

  const { form, fields } = useForm(TwoFASetupSchema, {
    id: "2fa-setup-form",
    lastResult: hasRecoveryCodes(actionData) ? undefined : actionData?.result,
  });

  if (hasRecoveryCodes(actionData)) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-lg">
          <Card>
            <CardHeader>
              <CardTitle>{t("saveRecoveryCodesTitle")}</CardTitle>
              <CardDescription>{t("saveRecoveryCodesSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 grid grid-cols-2 gap-2 rounded-lg border p-4">
                {actionData.recoveryCodes.map((code) => (
                  <code key={code} className="font-mono text-sm">
                    {code}
                  </code>
                ))}
              </div>
              <Button asChild className="w-full">
                <Link to="/">{t("recoveryCodesContinue")}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>{t("twoFactorSetupTitle")}</CardTitle>
            <CardDescription>{t("twoFactorSetupSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex flex-col items-center gap-4">
              <div className="border-muted-foreground/25 rounded-xl border-2 border-dashed bg-white p-4">
                <img alt="2FA QR code" src={loaderData.qrCode} className="h-48 w-48" />
              </div>
              <div className="text-muted-foreground w-full text-center text-sm">
                <p>If you can't scan the QR code, enter this secret manually:</p>
                <p className="mt-1 font-mono text-xs break-all">{loaderData.secret}</p>
                <p className="mt-2 text-xs">
                  Account <span className="font-mono">{loaderData.email}</span> · Issuer{" "}
                  <span className="font-mono">{loaderData.issuer}</span>
                </p>
              </div>
            </div>

            <Form method="POST" {...getFormProps(form)}>
              <AuthenticityTokenInput />
              <HoneypotInputs />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={fields.code.id}>{t("verificationCode")}</FieldLabel>
                  <Input
                    {...getInputProps(fields.code, { type: "text" })}
                    key={fields.code.key}
                    placeholder="000000"
                    autoFocus
                  />
                  {fields.code.errors && <FieldError>{fields.code.errors}</FieldError>}
                </Field>
                <ErrorList errors={form.errors} id={form.errorId} />
                <StatusButton
                  className="w-full"
                  status={isPending ? "pending" : (form.status ?? "idle")}
                  type="submit"
                  disabled={isPending}
                >
                  {t("enableTwoFactor")}
                </StatusButton>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
