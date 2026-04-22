import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────
// Entity payload schemas
//
// These describe the shape of the data a focal person submits for a given
// entity. They are NOT tied to any specific operation — the same payload
// schema validates CREATE (required fields enforced) and UPDATE (same
// fields; partial updates still send the full shape from the editor form).
//
// The submission envelope (submitChangeSchema) carries these as `payload`
// and the service dispatches on entityType at validate-time.
// ─────────────────────────────────────────────────────────────────────────

const nullableString = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const nullableCuid = () =>
  z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const isoDate = () =>
  z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || !Number.isNaN(Date.parse(v)), {
      message: "Invalid date",
    });

export const organizationPayloadSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
  acronym: nullableString(50),
  typeId: z.string({ error: "Type is required" }).min(1, "Type is required"),
  parentId: nullableCuid(),
  description: nullableString(10_000),
  mandate: nullableString(10_000),
  establishmentDate: isoDate(),
  isActive: z.coerce.boolean().default(true),
  website: nullableString(255),
  email: nullableString(255),
  phone: nullableString(50),
  address: nullableString(1000),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type OrganizationPayload = z.infer<typeof organizationPayloadSchema>;

// Optional initial-assignment block carried on Person CREATE payloads so a
// person can be provisioned together with their first position in a single
// approval cycle. Ignored on UPDATE. When present on CREATE, the apply path
// creates the person AND the assignment inside the same transaction.
const initialAssignmentSchema = z.object({
  positionId: z.string().trim().min(1, "Position is required"),
  startDate: z
    .string()
    .trim()
    .min(1, "Start date is required")
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid start date" }),
  notes: nullableString(2000),
});

export const personPayloadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  honorific: nullableString(50),
  email: nullableString(255),
  phone: nullableString(50),
  bio: nullableString(10_000),
  photoUrl: nullableString(500),
  memberStateId: nullableCuid(),
  languages: z.array(z.string().length(2).max(10)).default([]),
  showEmail: z.coerce.boolean().default(false),
  showPhone: z.coerce.boolean().default(false),
  initialAssignment: initialAssignmentSchema.optional(),
});
export type PersonPayload = z.infer<typeof personPayloadSchema>;

export const positionPayloadSchema = z.object({
  organizationId: z
    .string({ error: "Organization is required" })
    .min(1, "Organization is required"),
  typeId: z.string({ error: "Type is required" }).min(1, "Type is required"),
  title: z.string().trim().min(1, "Title is required").max(255),
  reportsToId: nullableCuid(),
  description: nullableString(10_000),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type PositionPayload = z.infer<typeof positionPayloadSchema>;

export const positionAssignmentPayloadSchema = z
  .object({
    positionId: z.string().min(1, "Position is required"),
    personId: z.string().min(1, "Person is required"),
    startDate: z
      .string()
      .min(1, "Start date is required")
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid start date" }),
    endDate: isoDate(),
    notes: nullableString(2000),
  })
  .refine((v) => !v.endDate || Date.parse(v.endDate) >= Date.parse(v.startDate), {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });
export type PositionAssignmentPayload = z.infer<typeof positionAssignmentPayloadSchema>;

// For DELETE operations the payload is a reason — not the entity fields.
export const deletePayloadSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type DeletePayload = z.infer<typeof deletePayloadSchema>;

// MOVE is a specialized Organization UPDATE — only parentId changes.
export const movePayloadSchema = z.object({
  parentId: nullableCuid(),
});
export type MovePayload = z.infer<typeof movePayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Submission + review envelopes
// ─────────────────────────────────────────────────────────────────────────

export const directoryEntityValues = [
  "ORGANIZATION",
  "PERSON",
  "POSITION",
  "POSITION_ASSIGNMENT",
] as const;
export type DirectoryEntityKey = (typeof directoryEntityValues)[number];

export const changeOperationValues = ["CREATE", "UPDATE", "DELETE", "MOVE"] as const;
export type ChangeOperationKey = (typeof changeOperationValues)[number];

// Top-level submission shape — service re-validates payload per (entityType, operation).
export const submitChangeSchema = z.object({
  entityType: z.enum(directoryEntityValues),
  operation: z.enum(changeOperationValues),
  entityId: z.string().optional(),
  payload: z.unknown(),
});
export type SubmitChangeInput = z.infer<typeof submitChangeSchema>;

export const approveChangeSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type ApproveChangeInput = z.infer<typeof approveChangeSchema>;

export const rejectChangeSchema = z.object({
  notes: z
    .string({ error: "A reason is required" })
    .trim()
    .min(1, "A reason is required")
    .max(2000),
});
export type RejectChangeInput = z.infer<typeof rejectChangeSchema>;

export const batchChangeSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one item").max(100),
  notes: z.string().trim().max(2000).optional(),
});
export type BatchChangeInput = z.infer<typeof batchChangeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Form schemas — consumed by the shared editor components. Deliberately
// simpler than the payload schemas: plain optional strings, no "" → null
// transforms. The change-request engine re-validates every payload through
// the payload schema at submit and apply time (see directory-changes
// `validatePayload`), which applies the transforms there. Keeping the form
// free of transforms sidesteps a Conform re-submit edge case where a
// transformed value round-trips back through a string-only check.
// ─────────────────────────────────────────────────────────────────────────

const formText = (max: number) => z.string().trim().max(max).optional();

export const organizationFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required").max(255),
  acronym: formText(50),
  typeId: z.string().min(1, "Type is required"),
  parentId: z.string().optional(),
  description: formText(10_000),
  mandate: formText(10_000),
  establishmentDate: z.string().optional(),
  isActive: z.coerce.boolean().default(true),
  website: formText(255),
  email: formText(255),
  phone: formText(50),
  address: formText(1000),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type OrganizationFormInput = z.infer<typeof organizationFormSchema>;

export const personFormSchema = z.object({
  id: z.string().optional(),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  honorific: formText(50),
  email: formText(255),
  phone: formText(50),
  bio: formText(10_000),
  photoUrl: formText(500),
  memberStateId: z.string().optional(),
  languages: z.array(z.string().length(2).max(10)).default([]),
  showEmail: z.coerce.boolean().default(false),
  showPhone: z.coerce.boolean().default(false),
  // Optional initial-assignment fields — only meaningful on CREATE. Kept
  // flat because Conform doesn't bind nested objects cleanly; the action
  // hoists them into `initialAssignment` before dispatching.
  initialPositionId: z.string().optional(),
  initialStartDate: z.string().optional(),
  initialNotes: formText(2000),
});
export type PersonFormInput = z.infer<typeof personFormSchema>;

export const positionFormSchema = z.object({
  id: z.string().optional(),
  organizationId: z.string().min(1, "Organization is required"),
  typeId: z.string().min(1, "Type is required"),
  title: z.string().trim().min(1, "Title is required").max(255),
  reportsToId: z.string().optional(),
  description: formText(10_000),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type PositionFormInput = z.infer<typeof positionFormSchema>;

export const assignPersonFormSchema = z.object({
  positionId: z.string().min(1),
  personId: z.string().min(1, "Pick a person"),
  startDate: z.string().min(1, "Start date is required"),
  notes: formText(2000),
});
export type AssignPersonFormInput = z.infer<typeof assignPersonFormSchema>;

export const endAssignmentFormSchema = z.object({
  id: z.string().min(1),
  positionId: z.string().min(1),
  personId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1, "End date is required"),
  notes: formText(2000),
});
export type EndAssignmentFormInput = z.infer<typeof endAssignmentFormSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Dispatch helpers — resolve a payload schema by (entityType, operation).
// Used both in the HTTP action and inside the change-request engine so the
// same validation runs at submit time and again right before apply.
// ─────────────────────────────────────────────────────────────────────────

export function payloadSchemaFor(
  entityType: DirectoryEntityKey,
  operation: ChangeOperationKey,
): z.ZodTypeAny {
  if (operation === "DELETE") return deletePayloadSchema;
  if (operation === "MOVE") {
    if (entityType !== "ORGANIZATION") {
      throw new Error(`MOVE is only valid for ORGANIZATION, got ${entityType}`);
    }
    return movePayloadSchema;
  }
  switch (entityType) {
    case "ORGANIZATION":
      return organizationPayloadSchema;
    case "PERSON":
      return personPayloadSchema;
    case "POSITION":
      return positionPayloadSchema;
    case "POSITION_ASSIGNMENT":
      return positionAssignmentPayloadSchema;
  }
}
