import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";

/**
 * Tiny wrapper around emitDomainEvent for user-creation events. Centralises
 * the payload shape so callers (signup, invitation-accept, tenant-setup) can't
 * drift.
 *
 * A tenantId is required — the domain-event bus is tenant-scoped, so user
 * creations that happen before a tenant is assigned (e.g., very early signup
 * before onboarding completes) should defer emission to the tenant-assignment
 * step rather than emit against a null tenant.
 */
export function emitUserCreated(
  user: { id: string; email: string },
  tenantId: string,
  extra?: Record<string, unknown>,
) {
  emitDomainEvent(tenantId, "user.created", {
    id: user.id,
    email: user.email,
    ...extra,
  });
}
