import { emitWebhookEvent } from "~/utils/events/webhook-emitter.server";

/**
 * Emit a domain event to external consumers via Webhooks. Fire-and-forget —
 * errors are suppressed so the caller's write path isn't blocked by a slow or
 * broken webhook endpoint.
 */
export function emitDomainEvent(
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
) {
  emitWebhookEvent(tenantId, eventType, data).catch(() => {});
}
