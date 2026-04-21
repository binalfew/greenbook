import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { requireFeature } from "~/utils/auth/require-auth.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { WebhookEditor } from "./+shared/webhook-editor";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New" };

export { action } from "./+shared/webhook-editor.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireFeature(request, "FF_WEBHOOKS");
  await requirePermission(request, "webhook", "write");
  return data({});
}

export default function NewWebhook({ actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("webhooks");
  const basePrefix = `/${params.tenant}/settings/webhooks`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <WebhookEditor actionData={actionData} basePrefix={basePrefix} />
    </div>
  );
}
