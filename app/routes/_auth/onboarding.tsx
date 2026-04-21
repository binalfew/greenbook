import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { CheckboxField, getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { StatusButton } from "~/components/ui/status-button";
import { getSessionExpirationDate, requireAnonymous, signup } from "~/utils/auth/auth.server";
import { sessionKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { useIsPending } from "~/utils/misc";
import { requireOnboardingEmail, verifySessionStorage } from "~/utils/auth/verification.server";
import type { Route } from "./+types/onboarding";

const SignupSchema = z
  .object({
    firstName: z.string({ error: "First name is required" }),
    lastName: z.string({ error: "Last name is required" }),
    tenantName: z
      .string({ error: "Organization name is required" })
      .min(2, { message: "Organization name is too short" })
      .max(120, { message: "Organization name is too long" }),
    password: z.string({ error: "Password is required" }),
    confirmPassword: z.string({
      error: "Confirm password is required",
    }),
    agreeToTermsOfServiceAndPrivacyPolicy: z.boolean({
      error: "You must agree to the terms of service and privacy policy",
    }),
    remember: z.boolean().optional(),
    redirectTo: z.string().optional(),
  })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        path: ["confirmPassword"],
        code: "custom",
        message: "The passwords must match",
      });
    }
  });

export async function loader({ request }: Route.LoaderArgs) {
  await requireAnonymous(request);
  const email = await requireOnboardingEmail(request);

  return data({ email });
}

export async function action({ request }: Route.ActionArgs) {
  await requireAnonymous(request);
  const email = await requireOnboardingEmail(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);
  const submission = await parseWithZod(formData, {
    schema: SignupSchema.superRefine(async (data, ctx) => {
      const existingUserByEmail = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUserByEmail) {
        ctx.addIssue({
          path: ["email"],
          code: z.ZodIssueCode.custom,
          message: "A user already exists with this email",
        });
      }
    }).transform(async (data) => {
      const { session, tenant } = await signup({ ...data, email, request });
      return { ...data, session, tenant };
    }),
    async: true,
  });

  if (submission.status !== "success") {
    return data(
      { result: submission.reply() },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { session, tenant, remember, redirectTo } = submission.value;

  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  cookieSession.set(sessionKey, session.id);

  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const headers = new Headers();
  headers.append(
    "set-cookie",
    await authSessionStorage.commitSession(cookieSession, {
      expires: remember ? getSessionExpirationDate() : undefined,
    }),
  );
  headers.append("set-cookie", await verifySessionStorage.destroySession(verifySession));

  // Land the new user on their freshly-bootstrapped tenant dashboard. An
  // explicit `redirectTo` override wins if provided (e.g. invite flow in T10).
  const destination = redirectTo || `/${tenant.slug}`;
  return redirect(safeRedirect(destination), { headers });
}

export default function SignupRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");

  const { form, fields } = useForm(SignupSchema, {
    id: "signup-form",
    lastResult: actionData?.result,
    defaultValue: {
      redirectTo: redirectTo ?? "",
    },
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t("onboardingTitle", { email: loaderData.email })}
              </CardTitle>
              <CardDescription>{t("onboardingSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form className="grid gap-4" method="POST" {...getFormProps(form)}>
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <input
                  {...getInputProps(fields.redirectTo, { type: "hidden" })}
                  key={fields.redirectTo.key}
                />
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel htmlFor={fields.firstName.id}>{t("firstName")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.firstName, { type: "text" })}
                      key={fields.firstName.key}
                    />
                    {fields.firstName.errors && <FieldError>{fields.firstName.errors}</FieldError>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={fields.lastName.id}>{t("lastName")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.lastName, { type: "text" })}
                      key={fields.lastName.key}
                    />
                    {fields.lastName.errors && <FieldError>{fields.lastName.errors}</FieldError>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={fields.tenantName.id}>{t("organizationName")}</FieldLabel>
                    <Input
                      {...getInputProps(fields.tenantName, { type: "text" })}
                      key={fields.tenantName.key}
                      placeholder="Acme Inc."
                    />
                    {fields.tenantName.errors && (
                      <FieldError>{fields.tenantName.errors}</FieldError>
                    )}
                  </Field>
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
                  <Field>
                    <div className="flex items-center gap-2">
                      <CheckboxField meta={fields.agreeToTermsOfServiceAndPrivacyPolicy} />
                      <Label
                        htmlFor={fields.agreeToTermsOfServiceAndPrivacyPolicy.id}
                        className="cursor-pointer text-sm"
                      >
                        {t("agreeToTerms")}
                      </Label>
                    </div>
                    {fields.agreeToTermsOfServiceAndPrivacyPolicy.errors && (
                      <FieldError>{fields.agreeToTermsOfServiceAndPrivacyPolicy.errors}</FieldError>
                    )}
                  </Field>
                  <Field>
                    <div className="flex items-center gap-2">
                      <CheckboxField meta={fields.remember} />
                      <Label htmlFor={fields.remember.id} className="cursor-pointer text-sm">
                        {t("rememberMe")}
                      </Label>
                    </div>
                    {fields.remember.errors && <FieldError>{fields.remember.errors}</FieldError>}
                  </Field>
                  <ErrorList errors={form.errors} id={form.errorId} />

                  <StatusButton
                    className="w-full"
                    status={isPending ? "pending" : (form.status ?? "idle")}
                    type="submit"
                    disabled={isPending}
                  >
                    {t("onboardingButton")}
                  </StatusButton>
                </div>
                <div className="mt-4 text-center text-sm">
                  {t("haveAccount")}{" "}
                  <Link to="/login" className="underline">
                    {t("signIn")}
                  </Link>
                </div>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
