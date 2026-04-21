// ─── Webhook Event Type Catalog ──────────────────────────
//
// Template-scoped catalog. Apps built on this template extend by merging
// their own event map into this one (or by maintaining a parallel catalog
// and concatenating the helpers' outputs in their admin UI).

export const WEBHOOK_EVENTS = {
  "user.created": "A new user has been created",
  "user.updated": "A user has been updated",
  "user.deleted": "A user has been deleted",
  "role.created": "A new role has been created",
  "role.updated": "A role has been updated",
  "role.deleted": "A role has been deleted",
  "tenant.created": "A new tenant has been created",
  "tenant.updated": "A tenant has been updated",
  "tenant.deleted": "A tenant has been deleted",
  "settings.changed": "A system setting has been changed",
  "invitation.created": "An invitation has been sent",
  "invitation.accepted": "An invitation has been accepted",
  "invitation.revoked": "An invitation has been revoked",
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;

export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

export function validateEventTypes(events: string[]): {
  valid: boolean;
  invalid: string[];
} {
  if (!Array.isArray(events) || events.length === 0) {
    return { valid: false, invalid: [] };
  }

  const invalid: string[] = [];
  for (const event of events) {
    if (event === "*") continue;
    if (!WEBHOOK_EVENT_TYPES.includes(event as WebhookEventType)) {
      invalid.push(event);
    }
  }

  return { valid: invalid.length === 0, invalid };
}

export function getEventsByDomain(): Record<
  string,
  { type: WebhookEventType; description: string }[]
> {
  const grouped: Record<string, { type: WebhookEventType; description: string }[]> = {};

  for (const [type, description] of Object.entries(WEBHOOK_EVENTS)) {
    const domain = type.split(".")[0];
    if (!grouped[domain]) {
      grouped[domain] = [];
    }
    grouped[domain].push({ type: type as WebhookEventType, description });
  }

  return grouped;
}
