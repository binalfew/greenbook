import { parseWithZod } from "@conform-to/zod/v4";
import * as E from "@react-email/components";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import { requireAnonymous } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { sendEmail } from "~/utils/email/email.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { useIsPending } from "~/utils/misc";
import { prepareVerification } from "~/utils/auth/verification.server";
import type { Route } from "./+types/signup";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign Up" }, { name: "description", content: "Sign Up" }];
}

const SignupSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email({ message: "Email is invalid" })
    .min(3, { message: "Email is too short" })
    .max(100, { message: "Email is too long" })
    .transform((value) => value.toLowerCase()),
  redirectTo: z.string().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  await requireAnonymous(request);
  return data({});
}

export async function action({ request }: Route.ActionArgs) {
  await requireAnonymous(request);
  const formData = await request.formData();

  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = await parseWithZod(formData, {
    schema: SignupSchema.superRefine(async (data, ctx) => {
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      });

      if (existingUser) {
        ctx.addIssue({
          path: ["email"],
          code: z.ZodIssueCode.custom,
          message: "A user already exists with this email",
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

  const { verifyUrl, redirectTo, otp } = await prepareVerification({
    period: 10 * 60,
    request,
    type: "onboarding",
    target: email,
  });

  const response = await sendEmail({
    to: email,
    subject: `Welcome to Accreditation!`,
    react: <SignupEmail onboardingUrl={verifyUrl.toString()} otp={otp} />,
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

export function SignupEmail({ onboardingUrl, otp }: { onboardingUrl: string; otp: string }) {
  return (
    <E.Html lang="en" dir="ltr">
      <E.Container>
        <h1>
          <E.Text>Welcome to Accreditation!</E.Text>
        </h1>
        <p>
          <E.Text>
            Here's your verification code: <strong>{otp}</strong>
          </E.Text>
        </p>
        <p>
          <E.Text>Or click the link to get started:</E.Text>
        </p>
        <E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
      </E.Container>
    </E.Html>
  );
}

export default function SignupRoute({ actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");

  const { form, fields } = useForm(SignupSchema, {
    id: "signup-form",
    defaultValue: { redirectTo: redirectTo ?? "" },
    lastResult: actionData?.result,
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("signupTitle")}</CardTitle>
              <CardDescription>{t("signupSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form method="POST" {...getFormProps(form)}>
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <input
                  {...getInputProps(fields.redirectTo, { type: "hidden" })}
                  key={fields.redirectTo.key}
                />

                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={fields.email.id}>{tCommon("email")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.email, { type: "email" })}
                      key={fields.email.key}
                      autoFocus
                    />
                    {fields.email.errors && <FieldError>{fields.email.errors}</FieldError>}
                  </Field>
                  <Field>
                    <StatusButton
                      className="w-full cursor-pointer"
                      status={isPending ? "pending" : (form.status ?? "idle")}
                      type="submit"
                      disabled={isPending}
                    >
                      {t("signupButton")}
                    </StatusButton>
                    <FieldDescription className="text-center">
                      {t("haveAccount")} <Link to="/login">{t("signIn")}</Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
