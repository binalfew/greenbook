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
import { consumeRecoveryCode } from "~/services/recovery-codes.server";
import type { Route } from "./+types/2fa-recovery";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Use a recovery code" },
    { name: "description", content: "Sign in with a two-factor recovery code" },
  ];
}

export const TwoFARecoverySchema = z.object({
  code: z
    .string({ error: "Recovery code is required" })
    .trim()
    .min(4, { message: "Recovery code is too short" })
    .max(32, { message: "Recovery code is too long" }),
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

  const submission = parseWithZod(formData, { schema: TwoFARecoverySchema });
  if (submission.status !== "success") {
    return data({ result: submission.reply() }, { status: 400 });
  }

  const { code, redirectTo } = submission.value;
  const valid = await consumeRecoveryCode(dbSession.userId, code);
  if (!valid) {
    return data(
      {
        result: submission.reply({
          fieldErrors: { code: ["Invalid or already used recovery code"] },
        }),
      },
      { status: 400 },
    );
  }

  await writeAudit({
    userId: dbSession.userId,
    action: "TWO_FACTOR_RECOVERY_USED",
    entityType: "user",
    entityId: dbSession.userId,
    description: "User bypassed 2FA via recovery code",
    request,
  });

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

  return redirect(safeRedirect(redirectTo || "/"), { headers });
}

export default function TwoFARecoveryRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { form, fields } = useForm(TwoFARecoverySchema, {
    id: "2fa-recovery-form",
    defaultValue: { redirectTo: loaderData.redirectTo },
    lastResult: actionData?.result,
  });

  const verifyHref = loaderData.redirectTo
    ? `/2fa-verify?redirectTo=${encodeURIComponent(loaderData.redirectTo)}`
    : "/2fa-verify";

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("twoFactorRecoveryTitle")}</CardTitle>
            <CardDescription>{t("twoFactorRecoverySubtitle")}</CardDescription>
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
                  <FieldLabel htmlFor={fields.code.id}>{t("recoveryCode")}</FieldLabel>
                  <Input
                    {...getInputProps(fields.code, { type: "text" })}
                    key={fields.code.key}
                    placeholder="abcd1234"
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
                  {t("signIn")}
                </StatusButton>
              </FieldGroup>
            </Form>
            <div className="mt-4 text-center text-sm">
              <Link to={verifyHref} className="underline-offset-4 hover:underline">
                {t("useAuthenticator")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
