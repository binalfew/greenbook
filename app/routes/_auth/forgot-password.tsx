import { parseWithZod } from "@conform-to/zod/v4";
import * as E from "@react-email/components";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import {
  AUTH_INPUT,
  AUTH_TEXT_LINK,
  AuthFieldError,
  AuthFormError,
  AuthHeading,
  AuthSubmit,
  useFocusOnMount,
} from "~/components/auth/auth-layout";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireAnonymous } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { sendEmail } from "~/utils/email/email.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { cn, useIsPending } from "~/utils/misc";
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
    subject: "Greenbook password reset",
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
          <E.Text>Greenbook password reset</E.Text>
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
  const emailRef = useFocusOnMount();
  const { form, fields } = useForm(ForgotPasswordSchema, {
    id: "forgot-password-form",
    lastResult: actionData?.result,
  });
  const { key: emailKey, ...emailProps } = getInputProps(fields.email, { type: "email" });

  return (
    <>
      <AuthHeading
        eyebrow={t("accountRecovery")}
        title={t("forgotPasswordTitle")}
        description={t("forgotPasswordSubtitle")}
      />

      <Form method="POST" {...getFormProps(form)} className="flex flex-col gap-4">
        <AuthenticityTokenInput />
        <HoneypotInputs />
        <div className="flex flex-col gap-2">
          <Label htmlFor={fields.email.id}>{tCommon("email")}</Label>
          <Input
            ref={emailRef}
            key={emailKey}
            {...emailProps}
            autoComplete="email"
            className={AUTH_INPUT}
          />
          <AuthFieldError id={fields.email.errorId} errors={fields.email.errors} />
        </div>

        <AuthFormError id={form.errorId} errors={form.errors} />

        <AuthSubmit pending={isPending}>{t("sendResetLink")}</AuthSubmit>
      </Form>

      <Link to="/login" className={cn(AUTH_TEXT_LINK, "self-start")}>
        {t("backToLogin")}
      </Link>
    </>
  );
}
