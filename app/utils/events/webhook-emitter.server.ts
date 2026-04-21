import crypto from "node:crypto";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { FEATURE_FLAG_KEYS } from "~/utils/config/feature-flag-keys";
import { dispatchWebhookEvent } from "~/services/webhook-dispatcher.server";
import { logger } from "~/utils/monitoring/logger.server";

export async function emitWebhookEvent(
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const enabled = await isFeatureEnabled(FEATURE_FLAG_KEYS.WEBHOOKS, { tenantId });
    if (!enabled) return;

    const eventId = crypto.randomUUID();
    await dispatchWebhookEvent(tenantId, eventType, eventId, data);
  } catch (error) {
    logger.warn(
      `[webhooks] emission failed for ${eventType} (tenant ${tenantId}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
