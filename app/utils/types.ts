import type { Submission } from "@conform-to/react";
import { createId as cuid } from "@paralleldrive/cuid2";
import { z } from "zod";
import {
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
} from "./auth/constants";

export const ToastSchema = z.object({
  description: z.string(),
  id: z.string().default(() => cuid()),
  title: z.string().optional(),
  type: z.enum(["message", "success", "error"]).default("message"),
});

export type Toast = z.infer<typeof ToastSchema>;
export type ToastInput = z.input<typeof ToastSchema>;

export const VerificationTypeSchema = z.enum(["reset-password", "change-email"]);

export type VerificationTypes = z.infer<typeof VerificationTypeSchema>;

export const VerifySchema = z.object({
  [codeQueryParam]: z
    .string({ error: "Enter the code from your email" })
    .length(6, "The code is 6 characters long"),
  [typeQueryParam]: VerificationTypeSchema,
  [targetQueryParam]: z.string(),
  [redirectToQueryParam]: z.string().optional(),
});

export type VerifyFunctionArgs = {
  request: Request;
  submission: Submission<z.infer<typeof VerifySchema>>;
  body: FormData | URLSearchParams;
};

export type SettingsNavItem = {
  title: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * @public
 */
export type ClientHint<Value> = {
  cookieName: string;
  getValueCode: string;
  fallback: Value;
  transform?: (value: string) => Value;
};

/**
 * @public
 */
export type ClientHintsValue<ClientHintsRecord> = {
  [K in keyof ClientHintsRecord]: ClientHintsRecord[K] extends ClientHint<infer Value>
    ? ClientHintsRecord[K]["transform"] extends (value: string) => Value
      ? ReturnType<ClientHintsRecord[K]["transform"]>
      : ClientHintsRecord[K]["fallback"]
    : never;
};
