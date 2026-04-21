import { parseWithZod } from "@conform-to/zod/v4";
import { KeyRound, Link2, Monitor, Shield, Unlink } from "lucide-react";
import { Form, Link, data, redirect, useFetcher } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import {
  getSSOConfigurations,
  getUserSSOConnections,
  unlinkSSOAccount,
} from "~/services/sso.server";
import { requireUserId } from "~/utils/auth/auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { prisma } from "~/utils/db/db.server";
import { profileSchema } from "~/utils/schemas/profile";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Profile" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Profile" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const tenant = await resolveTenant(params.tenant);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  const [sessionCount, ssoConnections, ssoConfigs] = await Promise.all([
    prisma.session.count({
      where: { userId, deletedAt: null, expiresAt: { gt: new Date() } },
    }),
    getUserSSOConnections(userId),
    getSSOConfigurations(tenant.id),
  ]);

  const connectedProviders = new Set(ssoConnections.map((c) => c.provider));
  const availableConfigs = ssoConfigs
    .filter((c) => c.isActive && !connectedProviders.has(c.provider))
    .map((c) => ({
      id: c.id,
      provider: c.provider,
      displayName: c.displayName,
      protocol: c.protocol,
    }));

  return data({
    user,
    sessionCount,
    ssoConnections,
    availableConfigs,
    tenantSlug: params.tenant,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const intent = formData.get("intent");

  if (intent === "disconnect_sso") {
    const connectionId = formData.get("connectionId");
    if (typeof connectionId === "string" && connectionId) {
      await unlinkSSOAccount(connectionId, userId);
    }
    return data({ ok: true });
  }

  const submission = parseWithZod(formData, { schema: profileSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: submission.value.firstName,
      lastName: submission.value.lastName,
    },
  });

  return redirect(`/${params.tenant}/profile`);
}

function getInitials(firstName: string, lastName: string, email: string): string {
  const first = firstName?.[0] ?? "";
  const last = lastName?.[0] ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined || email[0].toUpperCase();
}

export default function ProfilePage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, sessionCount, ssoConnections, availableConfigs, tenantSlug } = loaderData;
  const disconnectFetcher = useFetcher();

  const isSubmissionReply = actionData && typeof actionData === "object" && "status" in actionData;

  const { form, fields } = useForm(profileSchema, {
    lastResult: isSubmissionReply ? actionData : undefined,
    defaultValue: {
      firstName: user.firstName,
      lastName: user.lastName,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full text-lg font-semibold">
          {getInitials(user.firstName, user.lastName, user.email)}
        </div>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Profile</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your account settings and security.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>
            Update your name. Email is set at signup and cannot be changed here.
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

            <div className="grid gap-2">
              <label className="text-muted-foreground text-sm font-medium">Email</label>
              <Input value={user.email} disabled className="bg-muted" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fields.firstName.id}>First name</FieldLabel>
                <Input
                  {...getInputProps(fields.firstName, { type: "text" })}
                  key={fields.firstName.key}
                />
                {fields.firstName.errors && <FieldError>{fields.firstName.errors}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={fields.lastName.id}>Last name</FieldLabel>
                <Input
                  {...getInputProps(fields.lastName, { type: "text" })}
                  key={fields.lastName.key}
                />
                {fields.lastName.errors && <FieldError>{fields.lastName.errors}</FieldError>}
              </Field>
            </div>

            <div className="pt-2">
              <Button type="submit">Save changes</Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            Security
          </CardTitle>
          <CardDescription>Manage your password.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                <KeyRound className="size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Password</p>
                <p className="text-muted-foreground text-sm">Change your account password.</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="change-password">Change password</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="size-5" />
            Active sessions
          </CardTitle>
          <CardDescription>Manage devices that are logged in to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {sessionCount} active {sessionCount === 1 ? "session" : "sessions"}
              </p>
              <p className="text-muted-foreground text-sm">
                View and manage all your active sessions.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="sessions">View sessions</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {(ssoConnections.length > 0 || availableConfigs.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-5" />
              Connected accounts
            </CardTitle>
            <CardDescription>
              Link your identity provider accounts for single sign-on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ssoConnections.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 flex size-10 items-center justify-center rounded-full">
                    <Shield className="text-primary size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{conn.provider}</p>
                    <p className="text-muted-foreground text-xs">{conn.email}</p>
                  </div>
                </div>
                <disconnectFetcher.Form method="post">
                  <AuthenticityTokenInput />
                  <input type="hidden" name="connectionId" value={conn.id} />
                  <Button
                    type="submit"
                    name="intent"
                    value="disconnect_sso"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Unlink className="mr-1.5 size-3.5" />
                    Disconnect
                  </Button>
                </disconnectFetcher.Form>
              </div>
            ))}

            {availableConfigs.length > 0 && ssoConnections.length > 0 && <Separator />}

            {availableConfigs.map((config) => (
              <div
                key={config.id}
                className="flex items-center justify-between rounded-lg border border-dashed p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                    <Shield className="text-muted-foreground size-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-sm font-medium">
                      {config.displayName || config.provider}
                    </p>
                    <p className="text-muted-foreground text-xs">Not connected</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link
                    to={`/sso/start?tenant=${encodeURIComponent(tenantSlug)}&configId=${config.id}&link=true`}
                  >
                    <Link2 className="mr-1.5 size-3.5" />
                    Connect
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
