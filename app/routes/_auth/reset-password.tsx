import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import {
  AUTH_TEXT_LINK,
  AuthFieldError,
  AuthFormError,
  AuthHeading,
  AuthSubmit,
  PasswordInput,
  useFocusOnMount,
} from "~/components/auth/auth-layout";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Label } from "~/components/ui/label";
import { resetUserPassword } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { cn, useIsPending } from "~/utils/misc";
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

export default function PasswordResetRoute({ actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const passwordRef = useFocusOnMount();

  const { form, fields } = useForm(ResetPasswordSchema, {
    id: "password-reset-form",
    lastResult: actionData?.result,
  });
  const {
    key: passwordKey,
    type: _passwordType,
    ...passwordProps
  } = getInputProps(fields.password, { type: "password" });
  const {
    key: confirmKey,
    type: _confirmType,
    ...confirmProps
  } = getInputProps(fields.confirmPassword, { type: "password" });

  return (
    <>
      <AuthHeading
        eyebrow={t("accountRecovery")}
        title={t("resetPasswordTitle")}
        description={t("resetPasswordSubtitle")}
      />

      <Form method="POST" {...getFormProps(form)} className="flex flex-col gap-4">
        <AuthenticityTokenInput />
        <HoneypotInputs />
        <div className="flex flex-col gap-2">
          <Label htmlFor={fields.password.id}>{t("newPassword")}</Label>
          <PasswordInput
            ref={passwordRef}
            key={passwordKey}
            {...passwordProps}
            autoComplete="new-password"
          />
          <AuthFieldError id={fields.password.errorId} errors={fields.password.errors} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={fields.confirmPassword.id}>{t("confirmPassword")}</Label>
          <PasswordInput key={confirmKey} {...confirmProps} autoComplete="new-password" />
          <AuthFieldError
            id={fields.confirmPassword.errorId}
            errors={fields.confirmPassword.errors}
          />
        </div>

        <AuthFormError id={form.errorId} errors={form.errors} />

        <AuthSubmit pending={isPending}>{t("resetPasswordButton")}</AuthSubmit>
      </Form>

      <Link to="/login" className={cn(AUTH_TEXT_LINK, "self-start")}>
        {t("backToLogin")}
      </Link>
    </>
  );
}
