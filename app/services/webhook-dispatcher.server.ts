import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { deliverWebhook } from "~/services/webhook-delivery.server";
import { logger } from "~/utils/monitoring/logger.server";

/**
 * Find active webhook subscriptions for this tenant + event, create a
 * WebhookDelivery row for each, and fire deliverWebhook asynchronously.
 * Honours an open circuit breaker (skip subscription if still within the
 * reset window).
 */
export async function dispatchWebhookEvent(
  tenantId: string,
  eventType: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      OR: [{ events: { has: eventType } }, { events: { has: "*" } }],
    },
    select: {
      id: true,
      maxRetries: true,
      retryBackoffMs: true,
      circuitBreakerOpen: true,
      circuitBreakerResetAt: true,
    },
  });

  if (subscriptions.length === 0) return;

  logger.info(
    `[webhooks] dispatching ${eventType} (${eventId}) to ${subscriptions.length} subscription(s) for tenant ${tenantId}`,
  );

  for (const sub of subscriptions) {
    if (sub.circuitBreakerOpen) {
      const resetAt = sub.circuitBreakerResetAt;
      if (resetAt && resetAt > new Date()) {
        continue;
      }
    }

    try {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          eventType,
          eventId,
          payload: payload as Prisma.InputJsonObject,
          maxAttempts: sub.maxRetries,
        },
      });

      deliverWebhook(delivery.id).catch((err) => {
        logger.warn(
          `[webhooks] delivery ${delivery.id} failed async: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    } catch (err) {
      logger.error(
        `[webhooks] failed to create delivery for subscription ${sub.id}, event ${eventType}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
