// ─── Domain Event Type Catalog ───────────────────────────
//
// Every event type passed to `emitDomainEvent`, with a one-line description.

export const DOMAIN_EVENTS = {
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
  "organization.created": "A directory organization has been created",
  "organization.updated": "A directory organization has been updated",
  "organization.deleted": "A directory organization has been deleted",
  "organization.moved": "A directory organization has been reparented",
  "person.created": "A directory person record has been created",
  "person.updated": "A directory person record has been updated",
  "person.deleted": "A directory person record has been deleted",
  "position.created": "A directory position has been created",
  "position.updated": "A directory position has been updated",
  "position.deleted": "A directory position has been deleted",
  "position.assigned": "A person has been assigned to a position",
  "position.ended": "A position assignment has been ended",
  "change.submitted": "A directory change request has been submitted for review",
  "change.approved": "A directory change request has been approved and applied",
  "change.rejected": "A directory change request has been rejected",
  "change.withdrawn": "A directory change request has been withdrawn by its submitter",
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENTS;
