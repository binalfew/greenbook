import { parseWithZod } from "@conform-to/zod/v4";
import * as E from "@react-email/components";
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
import { requireAnonymous } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { sendEmail } from "~/utils/email/email.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { useIsPending } from "~/utils/misc";
import { prepareVerification } from "~/utils/auth/verification.server";
import type { Route } from "./+types/forgot-password";
const ForgotPasswordSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email({ message: "Email is invalid" })
    .min(3, { message: "Email is too short" })
    .max(100, { message: "Email is too long" })
    .transform((value) => value.toLowerCase()),
});

export async function action({ request }: Route.ActionArgs) {
  await requireAnonymous(request);
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = await parseWithZod(formData, {
    schema: ForgotPasswordSchema.superRefine(async (data, ctx) => {
      const user = await prisma.user.findFirst({
        where: {
          email: data.email,
        },
      });

      if (!user) {
        ctx.addIssue({
          path: ["email"],
          code: z.ZodIssueCode.custom,
          message: "No user found with that email",
        });
        return;
      }
    }),
    async: true,
  });

  if (submission.status !== "success") {
    return data(
      { result: submission.reply() },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { email } = submission.value;
  const user = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { email: true },
  });

  const { verifyUrl, redirectTo, otp } = await prepareVerification({
    period: 10 * 60,
    request,
    type: "reset-password",
    target: email,
  });

  const response = await sendEmail({
    to: user.email,
    subject: `Accreditation Password Reset`,
    react: <ForgotPasswordEmail onboardingUrl={verifyUrl.toString()} otp={otp} />,
  });

  if (response.status === "success") {
    return redirect(redirectTo.toString());
  } else {
    return data(
      { result: submission.reply({ formErrors: [response.error.message] }) },
      { status: 500 },
    );
  }
}

function ForgotPasswordEmail({ onboardingUrl, otp }: { onboardingUrl: string; otp: string }) {
  return (
    <E.Html lang="en" dir="ltr">
      <E.Container>
        <h1>
          <E.Text>Epic Notes Password Reset</E.Text>
        </h1>
        <p>
          <E.Text>
            Here's your verification code: <strong>{otp}</strong>
          </E.Text>
        </p>
        <p>
          <E.Text>Or click the link:</E.Text>
        </p>
        <E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
      </E.Container>
    </E.Html>
  );
}

export default function ForgotPasswordRoute({ actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { form, fields } = useForm(ForgotPasswordSchema, {
    id: "forgot-password-form",
    lastResult: actionData?.result,
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{t("forgotPasswordTitle")}</CardTitle>
              <CardDescription>{t("forgotPasswordSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form className="grid gap-4" method="POST" {...getFormProps(form)}>
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel htmlFor={fields.email.id}>{tCommon("email")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.email, { type: "email" })}
                      key={fields.email.key}
                    />
                    {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
                  </Field>

                  <ErrorList errors={form.errors} id={form.errorId} />

                  <StatusButton
                    className="w-full"
                    status={isPending ? "pending" : (form.status ?? "idle")}
                    type="submit"
                    disabled={isPending}
                  >
                    {t("sendResetLink")}
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
