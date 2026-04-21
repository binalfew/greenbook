import { z } from "zod/v4";

// ─── Data Subject Request ──────────────────────────────

export const createDSRSchema = z.object({
  requestType: z.enum([
    "ACCESS",
    "RECTIFICATION",
    "ERASURE",
    "RESTRICTION",
    "PORTABILITY",
    "OBJECTION",
  ]),
  subjectEmail: z
    .string({ error: "Subject email is required" })
    .min(1, "Subject email is required")
    .email("Must be a valid email"),
  subjectUserId: z.string().optional(),
  description: z.string().optional(),
});

export type CreateDSRInput = z.infer<typeof createDSRSchema>;

export const completeDSRSchema = z.object({
  responseNotes: z.string().optional(),
  exportUrl: z.string().optional(),
});

export type CompleteDSRInput = z.infer<typeof completeDSRSchema>;

export const denyDSRSchema = z.object({
  responseNotes: z.string({ error: "Reason is required" }).min(1, "Reason for denial is required"),
});

export type DenyDSRInput = z.infer<typeof denyDSRSchema>;

// ─── Consent Record ────────────────────────────────────

// Generic purposes shipped with the template. Apps can extend by passing additional
// purpose strings through the service — the `purpose` column is VarChar(100).
export const recordConsentSchema = z.object({
  userId: z.string({ error: "User is required" }).min(1, "User is required"),
  purpose: z
    .string({ error: "Purpose is required" })
    .min(1, "Purpose is required")
    .max(100, "Purpose is too long"),
  lawfulBasis: z.enum(["CONSENT", "CONTRACT", "LEGITIMATE_INTEREST", "LEGAL_OBLIGATION"]),
  isGranted: z.string().transform((val) => val === "true"),
  source: z.string().optional(),
});

export type RecordConsentInput = z.infer<typeof recordConsentSchema>;
