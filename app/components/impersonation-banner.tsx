import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Button } from "~/components/ui/button";

type ImpersonationBannerProps = {
  impersonatedEmail: string;
  originalEmail?: string;
};

export function ImpersonationBanner({
  impersonatedEmail,
  originalEmail,
}: ImpersonationBannerProps) {
  const { t } = useTranslation("nav");
  return (
    <div className="sticky top-0 z-50 flex w-full items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-amber-950 shadow-md">
      <div>
        <strong>{t("impersonating")}:</strong> {impersonatedEmail}
        {originalEmail && <span className="ml-2 opacity-80">(as {originalEmail})</span>}
      </div>
      <Form method="post" action="/resources/impersonate" className="flex-shrink-0">
        <AuthenticityTokenInput />
        <input type="hidden" name="intent" value="stop" />
        <Button type="submit" size="sm" variant="outline" className="bg-white/70 hover:bg-white">
          {t("stopImpersonating")}
        </Button>
      </Form>
    </div>
  );
}
