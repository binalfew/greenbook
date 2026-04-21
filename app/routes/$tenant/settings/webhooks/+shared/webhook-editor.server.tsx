import { parseWithZod } from "@conform-to/zod/v4";
import { data, redirect } from "react-router";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import {
  createWebhookSubscription,
  updateWebhookSubscription,
  WebhookError,
} from "~/services/webhooks.server";
import type { ActionFunctionArgs } from "react-router";
import { parseHeaders, webhookFormSchema } from "./webhook-schema";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const hasId = typeof formData.get("id") === "string" && (formData.get("id") as string).length > 0;
  const user = await requirePermission(request, "webhook", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const submission = parseWithZod(formData, { schema: webhookFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  let headers: Record<string, string> | undefined;
  try {
    headers = parseHeaders(submission.value.headersJson);
  } catch (err) {
    return data(
      submission.reply({
        fieldErrors: {
          headersJson: [err instanceof Error ? err.message : "Invalid headers JSON"],
        },
      }),
      { status: 400 },
    );
  }

  const ctx = buildServiceContext(request, user, tenantId);

  try {
    if (submission.value.id) {
      const updated = await updateWebhookSubscription(
        submission.value.id,
        {
          url: submission.value.url,
          description: submission.value.description,
          events: submission.value.events,
          headers,
        },
        ctx,
      );
      return redirect(`/${params.tenant}/settings/webhooks/${updated.id}`);
    } else {
      const { subscription } = await createWebhookSubscription(
        {
          url: submission.value.url,
          description: submission.value.description,
          events: submission.value.events,
          headers,
        },
        ctx,
      );
      // Surface the secret once via a query flag; the detail page reads it from
      // URL + a one-shot flash.
      return redirect(`/${params.tenant}/settings/webhooks/${subscription.id}?secretRevealed=1`);
    }
  } catch (err) {
    if (err instanceof WebhookError) {
      return data(submission.reply({ formErrors: [err.message] }), { status: err.status });
    }
    throw err;
  }
}
