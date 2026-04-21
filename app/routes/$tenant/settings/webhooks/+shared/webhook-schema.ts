import { z } from "zod/v4";

export const webhookFormSchema = z.object({
  id: z.string().optional(),
  url: z
    .string({ error: "URL is required" })
    .min(1, "URL is required")
    .refine((v) => /^https?:\/\//i.test(v), { message: "URL must start with http:// or https://" }),
  description: z.string().optional().default(""),
  events: z.array(z.string()).min(1, "Select at least one event"),
  headersJson: z.string().optional().default(""),
});

export type WebhookFormInput = z.infer<typeof webhookFormSchema>;

/** Parse the free-form headersJson textarea into a record, or return `undefined` if empty. */
export function parseHeaders(headersJson: string | undefined): Record<string, string> | undefined {
  if (!headersJson || headersJson.trim().length === 0) return undefined;
  const parsed = JSON.parse(headersJson);
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    throw new Error("Headers must be a JSON object");
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") throw new Error(`Header "${k}" must be a string`);
    result[k] = v;
  }
  return result;
}
