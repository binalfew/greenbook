import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import { ErrorList } from "~/components/error-list";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import { writeAudit } from "~/utils/auth/audit.server";
import {
  addPasswordToHistory,
  getPasswordHash,
  isPasswordInHistory,
  verifyUserPassword,
} from "~/utils/auth/auth.server";
import { unverifiedSessionIdKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { verifySessionStorage } from "~/utils/auth/verification.server";
import { prisma } from "~/utils/db/db.server";
import { useIsPending } from "~/utils/misc";
import type { Route } from "./+types/change-expired-password";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Change expired password" },
    { name: "description", content: "Your password has expired — set a new one" },
  ];
}

export const ChangeExpiredPasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Current password is required" }),
    newPassword: z
      .string({ error: "New password is required" })
      .min(8, { message: "Password must be at least 8 characters" }),
    confirmPassword: z.string({ error: "Please confirm your new password" }),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "New password must differ from the current one",
    path: ["newPassword"],
  });

async function resolveUnverifiedSession(request: Request) {
  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const unverifiedSessionId = verifySession.get(unverifiedSessionIdKey);
  if (!unverifiedSessionId) throw redirect("/login");

  const dbSession = await prisma.session.findUnique({
    where: { id: unverifiedSessionId },
    select: { userId: true },
  });
  if (!dbSession) throw redirect("/login");

  const userPassword = await prisma.password.findUnique({
    where: { userId: dbSession.userId },
    select: { hash: true },
  });
  if (!userPassword) throw redirect("/login");

  return { verifySession, unverifiedSessionId, userId: dbSession.userId, hash: userPassword.hash };
}

export async function loader({ request }: Route.LoaderArgs) {
  await resolveUnverifiedSession(request);
  return data({});
}

export async function action({ request }: Route.ActionArgs) {
  const { verifySession, unverifiedSessionId, userId } = await resolveUnverifiedSession(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = parseWithZod(formData, { schema: ChangeExpiredPasswordSchema });
  if (submission.status !== "success") {
    return data(
      {
        result: submission.reply({
          hideFields: ["currentPassword", "newPassword", "confirmPassword"],
        }),
      },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword } = submission.value;

  const user = await verifyUserPassword({ id: userId }, currentPassword);
  if (!user) {
    return data(
      {
        result: submission.reply({
          fieldErrors: { currentPassword: ["Current password is incorrect"] },
        }),
      },
      { status: 400 },
    );
  }

  if (await isPasswordInHistory(userId, newPassword)) {
    return data(
      {
        result: submission.reply({
          fieldErrors: { newPassword: ["Cannot reuse a recent password"] },
        }),
      },
      { status: 400 },
    );
  }

  const existing = await prisma.password.findUnique({
    where: { userId },
    select: { hash: true },
  });
  if (existing) {
    await addPasswordToHistory(userId, existing.hash);
  }

  const newHash = await getPasswordHash(newPassword);
  await prisma.password.update({
    where: { userId },
    data: { hash: newHash, lastChanged: new Date() },
  });

  // Invalidate all sessions (including the pending unverified one) so the user
  // must re-authenticate with the new password.
  await prisma.session.deleteMany({ where: { userId } });

  await writeAudit({
    userId,
    action: "PASSWORD_CHANGE",
    entityType: "user",
    entityId: userId,
    description: "Expired password changed — all sessions invalidated",
    request,
  });

  void unverifiedSessionId; // consumed above via deleteMany

  return redirect("/login", {
    headers: {
      "set-cookie": await verifySessionStorage.destroySession(verifySession),
    },
  });
}

export default function ChangeExpiredPasswordRoute({ actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");

  const { form, fields } = useForm(ChangeExpiredPasswordSchema, {
    id: "change-expired-password-form",
    lastResult: actionData?.result,
  });

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("changeExpiredTitle")}</CardTitle>
            <CardDescription>{t("changeExpiredSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="POST" {...getFormProps(form)}>
              <AuthenticityTokenInput />
              <HoneypotInputs />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={fields.currentPassword.id}>
                    {t("currentPassword")}
                  </FieldLabel>
                  <Input
                    {...getInputProps(fields.currentPassword, { type: "password" })}
                    key={fields.currentPassword.key}
                    autoFocus
                  />
                  {fields.currentPassword.errors && (
                    <FieldError>{fields.currentPassword.errors}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={fields.newPassword.id}>{t("newPassword")}</FieldLabel>
                  <Input
                    {...getInputProps(fields.newPassword, { type: "password" })}
                    key={fields.newPassword.key}
                  />
                  {fields.newPassword.errors && (
                    <FieldError>{fields.newPassword.errors}</FieldError>
                  )}
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
                  {t("changePasswordButton")}
                </StatusButton>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
