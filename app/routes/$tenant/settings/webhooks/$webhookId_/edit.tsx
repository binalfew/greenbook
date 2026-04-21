import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getWebhookSubscription } from "~/services/webhooks.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { WebhookEditor } from "../+shared/webhook-editor";
import type { Route } from "./+types/edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "../+shared/webhook-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  await requirePermission(request, "webhook", "write");

  const subscription = await getWebhookSubscription(params.webhookId, tenantId);
  if (!subscription) {
    throw data({ error: "Webhook subscription not found" }, { status: 404 });
  }

  return data({ subscription });
}

export default function EditWebhook({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("webhooks");
  const basePrefix = `/${params.tenant}/settings/webhooks`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground truncate text-sm">{loaderData.subscription.url}</p>
      </header>
      <WebhookEditor
        subscription={{
          id: loaderData.subscription.id,
          url: loaderData.subscription.url,
          description: loaderData.subscription.description,
          events: loaderData.subscription.events,
          headers: loaderData.subscription.headers,
        }}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
