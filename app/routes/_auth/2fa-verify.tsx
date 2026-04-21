import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import { writeAudit } from "~/utils/auth/audit.server";
import {
  rememberMeSessionKey,
  sessionKey,
  unverifiedSessionIdKey,
  verifiedTimeKey,
} from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { verifySessionStorage } from "~/utils/auth/verification.server";
import { prisma } from "~/utils/db/db.server";
import { useIsPending } from "~/utils/misc";
import { verify2FAChallenge } from "~/services/two-factor.server";
import type { Route } from "./+types/2fa-verify";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Two-factor authentication" },
    { name: "description", content: "Enter your two-factor authentication code" },
  ];
}

export const TwoFAVerifySchema = z.object({
  code: z
    .string({ error: "Code is required" })
    .trim()
    .min(6, { message: "Code must be at least 6 digits" })
    .max(8, { message: "Code is too long" }),
  redirectTo: z.string().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const unverifiedSessionId = verifySession.get(unverifiedSessionIdKey);
  if (!unverifiedSessionId) {
    throw redirect("/login");
  }
  const dbSession = await prisma.session.findUnique({
    where: { id: unverifiedSessionId },
    select: { id: true },
  });
  if (!dbSession) {
    throw redirect("/login");
  }
  const redirectTo = new URL(request.url).searchParams.get("redirectTo") ?? "";
  return data({ redirectTo });
}

export async function action({ request }: Route.ActionArgs) {
  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const unverifiedSessionId = verifySession.get(unverifiedSessionIdKey);
  if (!unverifiedSessionId) {
    throw redirect("/login");
  }

  const dbSession = await prisma.session.findUnique({
    where: { id: unverifiedSessionId },
    select: { userId: true, expiresAt: true },
  });
  if (!dbSession) {
    throw redirect("/login");
  }

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = parseWithZod(formData, { schema: TwoFAVerifySchema });
  if (submission.status !== "success") {
    return data({ result: submission.reply() }, { status: 400 });
  }

  const { code, redirectTo } = submission.value;

  const valid = await verify2FAChallenge(dbSession.userId, code);
  if (!valid) {
    return data(
      { result: submission.reply({ fieldErrors: { code: ["Invalid code"] } }) },
      { status: 400 },
    );
  }

  await writeAudit({
    userId: dbSession.userId,
    action: "TWO_FACTOR_VERIFY",
    entityType: "user",
    entityId: dbSession.userId,
    description: "Two-factor challenge passed",
    request,
  });

  // Promote the unverified session into a fully-authenticated session.
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const rememberMe = verifySession.get(rememberMeSessionKey);
  cookieSession.set(verifiedTimeKey, Date.now());
  cookieSession.set(sessionKey, unverifiedSessionId);

  const headers = new Headers();
  headers.append(
    "set-cookie",
    await authSessionStorage.commitSession(cookieSession, {
      expires: rememberMe ? dbSession.expiresAt : undefined,
    }),
  );
  headers.append("set-cookie", await verifySessionStorage.destroySession(verifySession));

  let destination = redirectTo;
  if (!destination) {
    const u = await prisma.user.findUnique({
      where: { id: dbSession.userId },
      select: { tenant: { select: { slug: true } } },
    });
    destination = u?.tenant?.slug ? `/${u.tenant.slug}` : "/";
  }

  return redirect(safeRedirect(destination), { headers });
}

export default function TwoFAVerifyRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");

  const { form, fields } = useForm(TwoFAVerifySchema, {
    id: "2fa-verify-form",
    defaultValue: { redirectTo: loaderData.redirectTo },
    lastResult: actionData?.result,
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("twoFactorVerifyTitle")}</CardTitle>
            <CardDescription>{t("twoFactorVerifySubtitle")}</CardDescription>
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
                  {t("verify")}
                </StatusButton>
              </FieldGroup>
            </Form>
            <div className="mt-4 text-center text-sm">
              <Link
                to={
                  loaderData.redirectTo
                    ? `/2fa-recovery?redirectTo=${encodeURIComponent(loaderData.redirectTo)}`
                    : "/2fa-recovery"
                }
                className="underline-offset-4 hover:underline"
              >
                {t("useRecoveryCode")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
