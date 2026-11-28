import { z } from "zod/v4";

export const createSSOConfigSchema = z.object({
  provider: z.enum(
    ["OKTA", "AZURE_AD", "GOOGLE", "CUSTOM_OIDC", "CUSTOM_SAML"],
    "Choose a provider",
  ),
  protocol: z.enum(["OIDC", "SAML"], "Choose a protocol"),
  displayName: z.string().optional(),
  issuerUrl: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  metadataUrl: z.string().optional(),
  callbackUrl: z.string({ error: "Callback URL is required" }).min(1, "Callback URL is required"),
  autoProvision: z.string().optional(),
  enforceSSO: z.string().optional(),
  isActive: z.string().optional(),
  defaultRoleId: z.string().optional(),
  // SAML-specific
  x509Certificate: z.string().optional(),
  ssoUrl: z.string().optional(),
  spEntityId: z.string().optional(),
  nameIdFormat: z.string().optional(),
});

export type CreateSSOConfigInput = z.infer<typeof createSSOConfigSchema>;
