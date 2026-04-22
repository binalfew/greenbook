import { parseWithZod } from "@conform-to/zod/v4";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { z } from "zod";
import { AuthContent } from "~/components/auth/auth-layout";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isPasswordExpired, login, requireAnonymous } from "~/utils/auth/auth.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { rememberMeSessionKey, sessionKey, unverifiedSessionIdKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { checkHoneypot } from "~/utils/auth/honeypot.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { useIsPending } from "~/utils/misc";
import { shouldRequestTwoFA, verifySessionStorage } from "~/utils/auth/verification.server";
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
              message: "Invalid email or password",
            });
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

  if (await shouldRequestTwoFA({ request, userId: session.userId })) {
    const verifySession = await verifySessionStorage.getSession();
    verifySession.set(unverifiedSessionIdKey, session.id);
    verifySession.set(rememberMeSessionKey, remember);

    const verifyUrl = new URL("/2fa-verify", new URL(request.url).origin);
    if (redirectTo) {
      verifyUrl.searchParams.set("redirectTo", redirectTo);
    }

    return redirect(verifyUrl.pathname + verifyUrl.search, {
      headers: {
        "set-cookie": await verifySessionStorage.commitSession(verifySession),
      },
    });
  } else {
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
}

/**
 * Resolve the post-auth landing URL. Tenant users go to their tenant slug;
 * users without a tenant (global admins, or rare unassigned accounts) land on
 * the root home page and can pick a destination from there.
 */
async function resolveDefaultRedirect(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenant: { select: { slug: true } } },
  });
  return user?.tenant?.slug ? `/${user.tenant.slug}` : "/";
}

export default function LoginRoute({ actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "";
  const emailRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const { form, fields } = useForm(LoginFormSchema, {
    id: "login-form",
    defaultValue: { redirectTo },
    lastResult: actionData?.result,
  });

  return (
    <AuthContent>
      <div className="mb-8">
        <h1 className="text-foreground text-3xl font-bold tracking-tight">{t("loginTitle")}</h1>
        <p className="text-muted-foreground mt-2">{t("loginSubtitle")}</p>
      </div>

      <Form method="post" {...getFormProps(form)} className="space-y-5">
        <AuthenticityTokenInput />
        <HoneypotInputs />
        <input
          {...getInputProps(fields.redirectTo, { type: "hidden" })}
          key={fields.redirectTo.key}
        />

        {form.errors && form.errors.length > 0 && (
          <div className="border-destructive/30 bg-destructive/5 flex animate-[shake_0.5s_ease-in-out] items-center gap-3 rounded-lg border px-4 py-3">
            <div className="bg-destructive/15 flex size-8 shrink-0 items-center justify-center rounded-full">
              <Lock className="text-destructive size-4" />
            </div>
            <p id={form.errorId} className="text-destructive text-sm">
              {form.errors[0]}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={fields.email.id} className="text-sm font-medium">
            {tCommon("email")}
          </Label>
          <div className="group relative">
            <Mail className="text-muted-foreground group-focus-within:text-primary absolute top-1/2 left-3 size-4 -translate-y-1/2 transition-colors" />
            {(() => {
              const { key, ...emailProps } = getInputProps(fields.email, { type: "email" });
              return (
                <Input
                  ref={emailRef}
                  key={key}
                  {...emailProps}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="focus-visible:shadow-primary/10 h-11 pl-10 transition-shadow focus-visible:shadow-md"
                />
              );
            })()}
          </div>
          {fields.email.errors && (
            <p className="text-destructive text-sm">{fields.email.errors[0]}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={fields.password.id} className="text-sm font-medium">
              {tCommon("password")}
            </Label>
            <Link
              to="/forgot-password"
              className="text-muted-foreground hover:text-primary text-xs transition-colors"
            >
              {t("forgotPassword")}
            </Link>
          </div>
          <div className="group relative">
            <Lock className="text-muted-foreground group-focus-within:text-primary absolute top-1/2 left-3 size-4 -translate-y-1/2 transition-colors" />
            {(() => {
              const { key, ...passwordProps } = getInputProps(fields.password, {
                type: showPassword ? "text" : "password",
              });
              return (
                <Input
                  key={key}
                  {...passwordProps}
                  autoComplete="current-password"
                  className="focus-visible:shadow-primary/10 h-11 pr-10 pl-10 transition-shadow focus-visible:shadow-md"
                />
              );
            })()}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {fields.password.errors && (
            <p className="text-destructive text-sm">{fields.password.errors[0]}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id={fields.remember.id} name={fields.remember.name} />
          <label
            htmlFor={fields.remember.id}
            className="text-muted-foreground cursor-pointer text-sm select-none"
          >
            {t("rememberMe")}
          </label>
        </div>

        <div className="space-y-3">
          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="shadow-primary/25 hover:shadow-primary/30 h-11 w-full text-base font-medium shadow-lg transition-all hover:shadow-xl"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {t("loginButton")}…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {t("loginButton")}
                <ArrowRight className="size-4" />
              </span>
            )}
          </Button>
          <p className="text-muted-foreground/60 text-center text-[11px]">
            Press{" "}
            <kbd className="border-border bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to sign in
          </p>
        </div>
      </Form>

      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background text-muted-foreground px-3">or</span>
        </div>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        {t("noAccount")}{" "}
        <Link
          to="/signup"
          className="text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          {t("signUp")}
        </Link>
      </p>
    </AuthContent>
  );
}
