import { parseWithZod } from "@conform-to/zod/v4";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  addPasswordToHistory,
  getPasswordHash,
  isPasswordInHistory,
  requireUserId,
  verifyUserPassword,
} from "~/utils/auth/auth.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { sessionKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { prisma } from "~/utils/db/db.server";
import { changePasswordSchema } from "~/utils/schemas/profile";
import type { Route } from "./+types/change-password";

export const handle = { breadcrumb: "Change Password" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Change password" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const submission = parseWithZod(formData, { schema: changePasswordSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const { currentPassword, newPassword } = submission.value;

  // `verifyUserPassword` returns the user row on success, or null on failure.
  const ok = await verifyUserPassword({ id: userId }, currentPassword);
  if (!ok) {
    return data(
      submission.reply({
        fieldErrors: { currentPassword: ["Current password is incorrect"] },
      }),
      { status: 400 },
    );
  }

  if (await isPasswordInHistory(userId, newPassword, 5)) {
    return data(
      submission.reply({
        fieldErrors: {
          newPassword: ["Cannot reuse a recent password. Please choose a different one."],
        },
      }),
      { status: 400 },
    );
  }

  const existing = await prisma.password.findUnique({ where: { userId } });
  if (existing) {
    await addPasswordToHistory(userId, existing.hash);
  }

  const newHash = await getPasswordHash(newPassword);
  await prisma.password.upsert({
    where: { userId },
    update: { hash: newHash, lastChanged: new Date() },
    create: { userId, hash: newHash },
  });

  // Invalidate every other session belonging to this user. The current
  // session stays alive so the user isn't bounced back to /login.
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const currentSessionId = cookieSession.get(sessionKey) as string | undefined;
  await prisma.session.deleteMany({
    where: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
  });

  await writeAudit({
    userId,
    action: "UPDATE",
    entityType: "user",
    entityId: userId,
    description: "Password changed — other sessions invalidated",
    request,
  });

  return redirect(`/${params.tenant}/profile`);
}

export default function ChangePasswordPage({ actionData, params }: Route.ComponentProps) {
  const { form, fields } = useForm(changePasswordSchema, {
    lastResult: actionData,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/${params.tenant}/profile`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Change password</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick a strong password you don&apos;t use elsewhere.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            New password
          </CardTitle>
          <CardDescription>
            Changing your password signs you out of every other active session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" {...getFormProps(form)} className="space-y-4">
            <AuthenticityTokenInput />

            {form.errors && form.errors.length > 0 && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {form.errors.map((error, i) => (
                  <p key={i}>{error}</p>
                ))}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor={fields.currentPassword.id}>Current password</FieldLabel>
              <Input
                {...getInputProps(fields.currentPassword, { type: "password" })}
                key={fields.currentPassword.key}
                autoComplete="current-password"
              />
              {fields.currentPassword.errors && (
                <FieldError>{fields.currentPassword.errors}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={fields.newPassword.id}>New password</FieldLabel>
              <Input
                {...getInputProps(fields.newPassword, { type: "password" })}
                key={fields.newPassword.key}
                autoComplete="new-password"
              />
              {fields.newPassword.errors && <FieldError>{fields.newPassword.errors}</FieldError>}
              <p className="text-muted-foreground mt-1 text-xs">
                At least 8 characters, with upper and lower case letters, a number, and a special
                character.
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor={fields.confirmPassword.id}>Confirm new password</FieldLabel>
              <Input
                {...getInputProps(fields.confirmPassword, { type: "password" })}
                key={fields.confirmPassword.key}
                autoComplete="new-password"
              />
              {fields.confirmPassword.errors && (
                <FieldError>{fields.confirmPassword.errors}</FieldError>
              )}
            </Field>

            <div className="flex gap-3 pt-2">
              <Button type="submit">Change password</Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/${params.tenant}/profile`}>Cancel</Link>
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
