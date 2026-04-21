import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import { resetUserPassword } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { useIsPending } from "~/utils/misc";
import { requireResetPasswordEmail, verifySessionStorage } from "~/utils/auth/verification.server";
import type { Route } from "./+types/reset-password";
const ResetPasswordSchema = z
  .object({
    password: z.string({ error: "Password is required" }),
    confirmPassword: z.string({
      error: "Confirm password is required",
    }),
  })
  .refine(({ confirmPassword, password }) => password === confirmPassword, {
    message: "The passwords did not match",
    path: ["confirmPassword"],
  });

export async function loader({ request }: Route.LoaderArgs) {
  const resetPasswordEmail = await requireResetPasswordEmail(request);

  return data({ resetPasswordEmail });
}

export async function action({ request }: Route.ActionArgs) {
  const resetPasswordEmail = await requireResetPasswordEmail(request);
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);
  const submission = parseWithZod(formData, {
    schema: ResetPasswordSchema,
  });

  if (submission.status !== "success") {
    return data(
      { result: submission.reply() },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { password } = submission.value;

  await resetUserPassword({ email: resetPasswordEmail, password, request });

  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));

  return redirect("/login", {
    headers: {
      "set-cookie": await verifySessionStorage.destroySession(verifySession),
    },
  });
}

export default function PasswordResetRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");

  const { form, fields } = useForm(ResetPasswordSchema, {
    id: "password-reset-form",
    lastResult: actionData?.result,
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{t("resetPasswordTitle")}</CardTitle>
              <CardDescription>{t("resetPasswordSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form className="grid gap-4" method="POST" {...getFormProps(form)}>
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel htmlFor={fields.password.id}>{t("newPassword")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.password, { type: "password" })}
                      key={fields.password.key}
                    />
                    {fields.password.errors && <FieldError>{fields.password.errors}</FieldError>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={fields.confirmPassword.id}>
                      {t("confirmPassword")}
                    </FieldLabel>
                    <Input
                      {...getInputProps(fields.confirmPassword, { type: "password" })}
                      key={fields.confirmPassword.key}
                    />
                    {fields.confirmPassword.errors && (
                      <FieldError>{fields.confirmPassword.errors}</FieldError>
                    )}
                  </Field>

                  <ErrorList errors={form.errors} id={form.errorId} />

                  <StatusButton
                    className="w-full"
                    status={isPending ? "pending" : (form.status ?? "idle")}
                    type="submit"
                    disabled={isPending}
                  >
                    {t("resetPasswordButton")}
                  </StatusButton>
                </div>
              </Form>
              <div className="mt-4 text-center text-sm">
                <Link to="/login" className="underline">
                  {t("backToLogin")}
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
