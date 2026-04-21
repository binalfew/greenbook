import { Form, data, useSearchParams, type MetaFunction } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { ErrorList } from "~/components/error-list";
import { getFormProps, getInputProps, useForm } from "~/components/form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { StatusButton } from "~/components/ui/status-button";
import {
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
} from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { VerificationTypeSchema, VerifySchema, type VerificationTypes } from "~/utils/types";
import { useIsPending } from "~/utils/misc";
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
  return [{ title: "Setup Accreditation Account" }];
};

export default function VerifyRoute({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const isPending = useIsPending();
  const type = VerificationTypeSchema.parse(searchParams.get(typeQueryParam));
  const checkEmail = (
    <>
      <h1 className="text-lg font-semibold">Check your Email</h1>
      <p className="mt-2 text-sm text-gray-600">
        We&apos;ve sent you a code to verify your email address. Please enter it below. Check your
        inbox or spam folder.
      </p>
    </>
  );

  const headings: Record<VerificationTypes, React.ReactNode> = {
    onboarding: checkEmail,
    "reset-password": checkEmail,
    "change-email": checkEmail,
    "2fa": (
      <>
        <h1 className="text-lg">Two-Factor Authentication</h1>
        <p className="mt-2 text-sm text-gray-600">
          Please enter your 2FA code to verify your identity.
        </p>
      </>
    ),
  };

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

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-6">
              <CardTitle className="text-center">{headings[type]}</CardTitle>
            </CardHeader>
            <CardContent>
              <Form className="space-y-6" method="POST" {...getFormProps(form)}>
                <AuthenticityTokenInput />
                <HoneypotInputs />
                <div className="space-y-4">
                  <Field>
                    <FieldLabel htmlFor={fields[codeQueryParam].id}>Code</FieldLabel>
                    <Input
                      {...getInputProps(fields[codeQueryParam], { type: "text" })}
                      key={fields[codeQueryParam].key}
                      placeholder="Enter your code"
                    />
                    {fields[codeQueryParam].errors && (
                      <FieldError>{fields[codeQueryParam].errors}</FieldError>
                    )}
                  </Field>

                  {/* Hidden Fields */}
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

                  <ErrorList errors={form.errors} id={form.errorId} />

                  <StatusButton
                    className="w-full"
                    status={isPending ? "pending" : (form.status ?? "idle")}
                    type="submit"
                    disabled={isPending}
                  >
                    Submit
                  </StatusButton>
                </div>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
