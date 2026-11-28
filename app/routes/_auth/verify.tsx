import { useTranslation } from "react-i18next";
import { Form, data, useSearchParams, type MetaFunction } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import {
  AUTH_INPUT,
  AuthFieldError,
  AuthFormError,
  AuthHeading,
  AuthSubmit,
  useFocusOnMount,
} from "~/components/auth/auth-layout";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
} from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { VerificationTypeSchema, VerifySchema } from "~/utils/types";
import { cn, useIsPending } from "~/utils/misc";
import { validateRequest } from "~/utils/auth/verification.server";
import type { Route } from "./+types/verify";

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  if (!params.has(codeQueryParam)) {
    // we don't want to show an error message on page load if the otp hasn't be prefilled in yet, so we'll send a response with an empty submission.
    return data({
      status: "idle",
      submission: {
        payload: Object.fromEntries(params) as Record<string, unknown>,
        error: {} as Record<string, Array<string>>,
      },
    } as const);
  }

  return validateRequest(request, params);
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);
  return validateRequest(request, formData);
}

export const meta: MetaFunction = () => {
  return [{ title: "Verify your email · Greenbook" }];
};

export default function VerifyRoute({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const isPending = useIsPending();
  const { t } = useTranslation("auth");
  // Refuses a link whose `type` is not one this page can verify.
  VerificationTypeSchema.parse(searchParams.get(typeQueryParam));
  const codeRef = useFocusOnMount();

  const { form, fields } = useForm(VerifySchema, {
    id: "verify-form",
    lastResult: actionData?.result,
    defaultValue: {
      code: searchParams.get(codeQueryParam) ?? "",
      type: searchParams.get(typeQueryParam) ?? "",
      target: searchParams.get(targetQueryParam) ?? "",
      redirectTo: searchParams.get(redirectToQueryParam) ?? "",
    },
  });
  const { key: codeKey, ...codeProps } = getInputProps(fields[codeQueryParam], { type: "text" });

  return (
    <>
      <AuthHeading
        eyebrow={t("verification")}
        title={t("verifyTitle")}
        description={t("verifySubtitle")}
      />

      <Form method="POST" {...getFormProps(form)} className="flex flex-col gap-4">
        <AuthenticityTokenInput />
        <HoneypotInputs />
        <div className="flex flex-col gap-2">
          <Label htmlFor={fields[codeQueryParam].id}>{t("verifyCode")}</Label>
          <Input
            ref={codeRef}
            key={codeKey}
            {...codeProps}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            className={cn(AUTH_INPUT, "font-mono tracking-[0.2em]")}
          />
          <AuthFieldError
            id={fields[codeQueryParam].errorId}
            errors={fields[codeQueryParam].errors}
          />
        </div>

        <input
          {...getInputProps(fields[typeQueryParam], { type: "hidden" })}
          key={fields[typeQueryParam].key}
        />
        <input
          {...getInputProps(fields[targetQueryParam], { type: "hidden" })}
          key={fields[targetQueryParam].key}
        />
        <input
          {...getInputProps(fields[redirectToQueryParam], { type: "hidden" })}
          key={fields[redirectToQueryParam].key}
        />

        <AuthFormError id={form.errorId} errors={form.errors} />

        <AuthSubmit pending={isPending}>{t("verifyButton")}</AuthSubmit>
      </Form>
    </>
  );
}
