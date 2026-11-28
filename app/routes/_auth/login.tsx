import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_TEXT_LINK,
  AuthFieldError,
  AuthFormError,
  AuthHeading,
  AuthSectionLabel,
  AuthSubmit,
  PasswordInput,
  useFocusOnMount,
} from "~/components/auth/auth-layout";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { SSOProvider } from "~/generated/prisma/client";
import { getActiveSSOConfigurations, isSSOEnforced } from "~/services/sso.server";
import { isPasswordExpired, login, requireAnonymous } from "~/utils/auth/auth.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { resolvePostLoginRedirect } from "~/utils/auth/post-login-redirect.server";
import { prisma } from "~/utils/db/db.server";
import { sessionKey, unverifiedSessionIdKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { cn, useIsPending } from "~/utils/misc";
import { verifySessionStorage } from "~/utils/auth/verification.server";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign in · Greenbook" },
    {
      name: "description",
      content:
        "Editorial access to the Greenbook — the African Union's directory of organizations, people, and positions.",
    },
  ];
}

export const LoginFormSchema = z.object({
  email: z.string({ error: "Email is required" }).email({ message: "Invalid email address" }),
  password: z.string({ error: "Password is required" }),
  remember: z.boolean().optional(),
  redirectTo: z.string().optional(),
});

interface SSOOption {
  id: string;
  provider: SSOProvider;
  displayName: string;
}

const PROVIDER_LABELS: Record<SSOProvider, string> = {
  OKTA: "Okta",
  AZURE_AD: "Microsoft / Azure AD",
  GOOGLE: "Google",
  CUSTOM_OIDC: "OIDC",
  CUSTOM_SAML: "SAML",
};

function labelFor(config: { displayName: string | null; provider: SSOProvider }): string {
  return config.displayName?.trim() || PROVIDER_LABELS[config.provider];
}

const PASSWORD_SIGN_IN_ADMINS_ONLY =
  "Password sign-in is only available to administrators. Use single sign-on instead.";

async function isGlobalAdminUser(userId: string): Promise<boolean> {
  const held = await prisma.userRole.count({
    where: { userId, role: { name: "admin", scope: "GLOBAL" } },
  });
  return held > 0;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAnonymous(request);

  const [configs, ssoEnforced] = await Promise.all([getActiveSSOConfigurations(), isSSOEnforced()]);
  const ssoOptions: SSOOption[] = configs.map((c) => ({
    id: c.id,
    provider: c.provider,
    displayName: labelFor(c),
  }));

  return data({ ssoOptions, ssoEnforced });
}

export async function action({ request }: Route.ActionArgs) {
  await requireAnonymous(request);
  const formData = await request.formData();

  await validateCSRF(formData, request.headers);
  checkHoneypot(formData);

  const ssoEnforced = await isSSOEnforced();

  const submission = await parseWithZod(formData, {
    schema: (intent) =>
      LoginFormSchema.transform(async (data, ctx) => {
        if (intent !== null) return { ...data, session: null };

        try {
          const session = await login({
            email: data.email,
            password: data.password,
            request,
          });

          if (!session) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: ssoEnforced ? PASSWORD_SIGN_IN_ADMINS_ONLY : "Invalid email or password",
            });
            return z.NEVER;
          }

          // Checked after the password so the answer is the same for a wrong
          // password and a non-admin: the form cannot be used to test either.
          if (ssoEnforced && !(await isGlobalAdminUser(session.userId))) {
            await prisma.session.delete({ where: { id: session.id } });
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: PASSWORD_SIGN_IN_ADMINS_ONLY });
            return z.NEVER;
          }

          return { ...data, session };
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : "An error occurred during login",
          });
          return z.NEVER;
        }
      }),
    async: true,
  });

  if (submission.status !== "success" || !submission.value.session) {
    return data(
      { result: submission.reply({ hideFields: ["password"] }) },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { session, remember, redirectTo } = submission.value;

  await writeAudit({
    userId: session.userId,
    action: "LOGIN",
    entityType: "user",
    entityId: session.userId,
    description: "User logged in",
    request,
  });

  const userPassword = await prisma.password.findUnique({
    where: { userId: session.userId },
    select: { lastChanged: true },
  });
  if (userPassword && isPasswordExpired(userPassword.lastChanged)) {
    await writeAudit({
      userId: session.userId,
      action: "PASSWORD_EXPIRED",
      entityType: "user",
      entityId: session.userId,
      description: "Password rotation required before full sign-in",
      request,
    });
    const verifySession = await verifySessionStorage.getSession();
    verifySession.set(unverifiedSessionIdKey, session.id);
    return redirect("/change-expired-password", {
      headers: {
        "set-cookie": await verifySessionStorage.commitSession(verifySession),
      },
    });
  }

  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  cookieSession.set(sessionKey, session.id);

  const destination = redirectTo || (await resolveDefaultRedirect(session.userId));
  return redirect(safeRedirect(destination), {
    headers: {
      "set-cookie": await authSessionStorage.commitSession(cookieSession, {
        expires: remember ? session.expiresAt : undefined,
      }),
    },
  });
}

/**
 * Resolve the post-auth landing URL. Tenant users go to their tenant slug;
 * users without a tenant (global admins, or rare unassigned accounts) land on
 * the root home page and can pick a destination from there.
 */
async function resolveDefaultRedirect(userId: string): Promise<string> {
  // Operators land in their tenant workspace; plain directory readers (`user`
  // role) land on the directory search at `/`.
  return resolvePostLoginRedirect(userId);
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className="size-4 shrink-0">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { ssoOptions, ssoEnforced } = loaderData;
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "";
  const ssoError = searchParams.get("error") ?? "";
  const hasSso = ssoOptions.length > 0;
  // With SSO required, the password form is the global admin's way in only,
  // reached through the link below the provider buttons (or after a failed try).
  const showPasswordForm =
    !ssoEnforced || searchParams.get("password") === "1" || actionData !== undefined;
  // The email takes focus when it is the obvious next step: there is no
  // provider button to press first, or the admin asked for the form.
  const emailRef = useFocusOnMount(showPasswordForm && (!hasSso || ssoEnforced));

  const { form, fields } = useForm(LoginFormSchema, {
    id: "login-form",
    defaultValue: { redirectTo },
    lastResult: actionData?.result,
  });

  const { key: emailKey, ...emailProps } = getInputProps(fields.email, { type: "email" });
  const {
    key: passwordKey,
    type: _passwordType,
    ...passwordProps
  } = getInputProps(fields.password, { type: "password" });

  return (
    <>
      <AuthHeading eyebrow={t("staffAccess")} title={t("loginTitle")} />

      <AuthFormError errors={ssoError ? [ssoError] : null} />

      {hasSso ? (
        <div className="flex flex-col gap-2.5">
          <AuthSectionLabel>{t("ssoSectionLabel")}</AuthSectionLabel>
          {ssoOptions.map((option) => {
            const params = new URLSearchParams({ configId: option.id });
            if (redirectTo) params.set("redirectTo", redirectTo);
            return (
              <Button
                key={option.id}
                asChild
                variant="outline"
                // Long provider names wrap instead of pushing the button wider than the page.
                className={cn(AUTH_BUTTON, "h-auto min-h-11 gap-2.5 px-4 py-2.5 whitespace-normal")}
              >
                <Link to={`/sso/start?${params.toString()}`} prefetch="intent">
                  {option.provider === "AZURE_AD" ? <MicrosoftMark /> : null}
                  <span className="text-balance">
                    {t("continueWith", { name: option.displayName })}
                  </span>
                </Link>
              </Button>
            );
          })}
        </div>
      ) : null}

      {showPasswordForm ? (
        <div className="flex flex-col gap-3">
          {hasSso ? <AuthSectionLabel>{t("passwordSectionLabel")}</AuthSectionLabel> : null}
          <Form method="post" {...getFormProps(form)} className="flex flex-col gap-4">
            <AuthenticityTokenInput />
            <HoneypotInputs />
            <input
              {...getInputProps(fields.redirectTo, { type: "hidden" })}
              key={fields.redirectTo.key}
            />

            <div className="flex flex-col gap-2">
              <Label htmlFor={fields.email.id}>{tCommon("email")}</Label>
              <Input
                ref={emailRef}
                key={emailKey}
                {...emailProps}
                placeholder="name@africanunion.org"
                autoComplete="email"
                className={AUTH_INPUT}
              />
              <AuthFieldError id={fields.email.errorId} errors={fields.email.errors} />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <Label htmlFor={fields.password.id}>{tCommon("password")}</Label>
                <Link
                  to="/forgot-password"
                  className="text-muted-foreground hover:text-foreground relative text-sm underline-offset-4 transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
              <PasswordInput key={passwordKey} {...passwordProps} autoComplete="current-password" />
              <AuthFieldError id={fields.password.errorId} errors={fields.password.errors} />
            </div>

            <label className="text-muted-foreground flex min-h-11 cursor-pointer items-center gap-2.5 text-sm select-none">
              <Checkbox id={fields.remember.id} name={fields.remember.name} />
              {t("rememberMe")}
            </label>

            <AuthFormError id={form.errorId} errors={form.errors} />

            <AuthSubmit pending={isPending} pendingLabel={t("signingIn")}>
              {t("loginButton")}
            </AuthSubmit>
          </Form>
        </div>
      ) : (
        <div className="flex flex-col">
          <p className="text-muted-foreground text-sm text-pretty">{t("ssoRequired")}</p>
          <Link
            to={`/login?${new URLSearchParams({ password: "1", ...(redirectTo ? { redirectTo } : {}) })}`}
            className={cn(AUTH_TEXT_LINK, "self-start")}
          >
            {t("adminPasswordSignIn")}
          </Link>
        </div>
      )}
    </>
  );
}
