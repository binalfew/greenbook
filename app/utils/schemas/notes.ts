import { z } from "zod/v4";

// ─── Note ────────────────────────────────────────────────

export const noteStatusValues = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

// Upsert shape — id is optional so the shared editor/action can create
// on absent id and update on present id (Phase 5 shared-editor pattern).
export const noteFormSchema = z.object({
  id: z.string().optional(),
  title: z
    .string({ error: "Title is required" })
    .min(1, "Title is required")
    .max(255, "Title is too long"),
  content: z.string().default(""),
  status: z.enum(noteStatusValues).default("DRAFT"),
  categoryId: z.string().optional(),
  // Tags are submitted as a single comma-separated string and normalised here.
  // Empty trimmed strings are dropped so `tags: ""` parses to `[]`.
  tags: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    ),
  dueDate: z.string().optional(),
});

export type NoteFormInput = z.infer<typeof noteFormSchema>;

// ─── Comment ─────────────────────────────────────────────

export const commentFormSchema = z.object({
  body: z
    .string({ error: "Comment body is required" })
    .min(1, "Comment body is required")
    .max(5000, "Comment is too long"),
});

export type CommentFormInput = z.infer<typeof commentFormSchema>;

// ─── Category ────────────────────────────────────────────

export const categoryFormSchema = z.object({
  id: z.string().optional(),
  name: z
    .string({ error: "Name is required" })
    .min(1, "Name is required")
    .max(100, "Name is too long"),
  color: z.string().optional(),
  parentId: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export type CategoryFormInput = z.infer<typeof categoryFormSchema>;
