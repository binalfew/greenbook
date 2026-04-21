import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
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
import { getPasswordHash, getSessionExpirationDate, getUserId } from "~/utils/auth/auth.server";
import { sessionKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { prisma } from "~/utils/db/db.server";
import { useIsPending } from "~/utils/misc";
import { acceptInvitation, getInvitationByToken } from "~/services/invitations.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/accept-invite";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Accept invitation" }];
}

export const AcceptInviteSchema = z
  .object({
    token: z.string().min(1),
    intent: z.enum(["accept", "signup"]),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.intent === "signup") {
      if (!v.firstName) {
        ctx.addIssue({ path: ["firstName"], code: "custom", message: "First name is required" });
      }
      if (!v.lastName) {
        ctx.addIssue({ path: ["lastName"], code: "custom", message: "Last name is required" });
      }
      if (!v.password || v.password.length < 8) {
        ctx.addIssue({
          path: ["password"],
          code: "custom",
          message: "Password must be at least 8 characters",
        });
      }
      if (v.password !== v.confirmPassword) {
        ctx.addIssue({
          path: ["confirmPassword"],
          code: "custom",
          message: "Passwords do not match",
        });
      }
    }
  });

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    throw data({ error: "Missing invitation token" }, { status: 400 });
  }

  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return data({ mode: "invalid" as const, reason: "Invitation not found" });
  }
  if (invitation.status !== "PENDING") {
    return data({
      mode: "invalid" as const,
      reason: `This invitation is already ${invitation.status.toLowerCase()}`,
    });
  }
  if (invitation.expiresAt < new Date()) {
    return data({ mode: "invalid" as const, reason: "This invitation has expired" });
  }

  const userId = await getUserId(request);
  if (userId) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (currentUser?.email === invitation.email) {
      return data({
        mode: "join" as const,
        token,
        invitation: {
          email: invitation.email,
          tenant: invitation.tenant,
        },
      });
    }
    return data({
      mode: "mismatch" as const,
      signedInAs: currentUser?.email ?? null,
      invitedEmail: invitation.email,
    });
  }

  // Anonymous visitor — offer signup flow pre-filled with invited email.
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  return data({
    mode: "signup" as const,
    token,
    invitation: {
      email: invitation.email,
      tenant: invitation.tenant,
    },
    userAlreadyExists: Boolean(existingUser),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const submission = parseWithZod(formData, { schema: AcceptInviteSchema });
  if (submission.status !== "success") {
    return data({ result: submission.reply() }, { status: 400 });
  }

  const { token, intent, firstName, lastName, password } = submission.value;

  const invitation = await getInvitationByToken(token);
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return data(
      { result: submission.reply({ formErrors: ["Invitation is no longer valid"] }) },
      { status: 400 },
    );
  }

  if (intent === "accept") {
    // Logged-in user accepting the invite.
    const userId = await getUserId(request);
    if (!userId) {
      throw redirect("/login");
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email !== invitation.email) {
      return data(
        { result: submission.reply({ formErrors: ["Invitation is for a different account"] }) },
        { status: 403 },
      );
    }
    const ctx = buildServiceContext(request, { id: userId });
    await acceptInvitation(token, userId, ctx);
    return redirect(`/${invitation.tenant.slug}`);
  }

  // intent === "signup" — create a new user, accept invite, sign them in.
  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (existing) {
    return data(
      {
        result: submission.reply({
          formErrors: ["An account with this email already exists — please sign in first"],
        }),
      },
      { status: 400 },
    );
  }

  const hashedPassword = await getPasswordHash(password!);
  const newUser = await prisma.user.create({
    data: {
      email: invitation.email,
      firstName: firstName!,
      lastName: lastName!,
      tenantId: invitation.tenantId,
      password: { create: { hash: hashedPassword } },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    select: { id: true, expiresAt: true },
    data: {
      userId: newUser.id,
      expiresAt: getSessionExpirationDate(),
    },
  });

  const ctx = buildServiceContext(request, { id: newUser.id });
  await acceptInvitation(token, newUser.id, ctx);

  await writeAudit({
    tenantId: invitation.tenantId,
    userId: newUser.id,
    action: "CREATE",
    entityType: "user",
    entityId: newUser.id,
    description: "User signed up via invitation acceptance",
    request,
  });

  const { emitUserCreated } = await import("~/utils/events/emit-user-created.server");
  emitUserCreated({ id: newUser.id, email: invitation.email }, invitation.tenantId, {
    source: "invitation",
    invitationId: invitation.id,
  });

  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  cookieSession.set(sessionKey, session.id);
  return redirect(`/${invitation.tenant.slug}`, {
    headers: {
      "set-cookie": await authSessionStorage.commitSession(cookieSession, {
        expires: session.expiresAt,
      }),
    },
  });
}

export default function AcceptInviteRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");

  if (loaderData.mode === "invalid") {
    return <SingleMessageCard title={t("invitationUnavailable")} body={loaderData.reason} />;
  }

  if (loaderData.mode === "mismatch") {
    return (
      <SingleMessageCard
        title={t("wrongAccountTitle")}
        body={
          <>
            You're signed in as <strong>{loaderData.signedInAs ?? "unknown"}</strong>, but this
            invitation is for <strong>{loaderData.invitedEmail}</strong>. Log out and try the link
            again.
          </>
        }
      />
    );
  }

  if (loaderData.mode === "join") {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>
                {t("acceptInviteJoinTitle", { tenant: loaderData.invitation.tenant.name })}
              </CardTitle>
              <CardDescription>
                {t("acceptInviteJoinSubtitle", { tenant: loaderData.invitation.tenant.name })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form method="POST">
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <input type="hidden" name="token" value={loaderData.token} />
                <input type="hidden" name="intent" value="accept" />
                <StatusButton
                  className="w-full"
                  type="submit"
                  status={isPending ? "pending" : "idle"}
                  disabled={isPending}
                >
                  {t("acceptInviteButton", { tenant: loaderData.invitation.tenant.name })}
                </StatusButton>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // signup mode
  return <AcceptInviteSignupForm loaderData={loaderData} actionData={actionData} />;
}

function SingleMessageCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm">
            <p>{body}</p>
            <p>
              <Link to="/login" className="underline-offset-4 hover:underline">
                Go to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AcceptInviteSignupForm({
  loaderData,
  actionData,
}: {
  loaderData: Extract<Route.ComponentProps["loaderData"], { mode: "signup" }>;
  actionData: Route.ComponentProps["actionData"];
}) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");

  const { form, fields } = useForm(AcceptInviteSchema, {
    id: "accept-invite-signup-form",
    lastResult: actionData?.result,
  });

  if (loaderData.userAlreadyExists) {
    return (
      <SingleMessageCard
        title={t("invitationUnavailable")}
        body={
          <>
            An account already exists for <strong>{loaderData.invitation.email}</strong>. Sign in
            and revisit this link to accept the invite.
          </>
        }
      />
    );
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>
              {t("acceptInviteJoinTitle", { tenant: loaderData.invitation.tenant.name })}
            </CardTitle>
            <CardDescription>
              {t("acceptInviteSignupSubtitle", { tenant: loaderData.invitation.tenant.name })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="POST" {...getFormProps(form)}>
              <AuthenticityTokenInput />
              <HoneypotInputs />
              <input type="hidden" name="token" value={loaderData.token} />
              <input type="hidden" name="intent" value="signup" />
              <FieldGroup>
                <div className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">{tCommon("email")}</span>
                  <span className="font-mono">{loaderData.invitation.email}</span>
                </div>
                <Field>
                  <FieldLabel htmlFor={fields.firstName.id}>{t("firstName")}</FieldLabel>
                  <Input
                    {...getInputProps(fields.firstName, { type: "text" })}
                    key={fields.firstName.key}
                    autoFocus
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
                  {t("acceptInviteButton", { tenant: loaderData.invitation.tenant.name })}
                </StatusButton>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
