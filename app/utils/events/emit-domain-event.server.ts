import { getRequestLogger } from "~/middleware/correlation.server";

/**
 * Announce a domain event (catalog: `~/utils/events/domain-events`). Events are
 * tenant-scoped and fire-and-forget: emitting never throws and never blocks
 * the caller's write path. There is no outbound delivery — the event is
 * recorded in the structured log, and in-process consumers (notifications,
 * audit trail) are invoked by the services that emit.
 */
export function emitDomainEvent(
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
) {
  getRequestLogger().debug({ tenantId, eventType, data }, "domain event");
}
