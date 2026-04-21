/**
 * Catalogue of system settings the template knows about. Drives the admin UI
 * (labels, types, options) and the default fallback when no DB row exists.
 *
 * Template-focused — adds foundational settings only (auth, general, upload,
 * email, audit). Application layers add their own entries as needed.
 */

export type SettingType = "string" | "number" | "boolean" | "select";

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  type: SettingType;
  defaultValue: string;
  options?: Array<{ value: string; label: string }>;
}

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  // ─── General ─────────────────────────────────────
  {
    key: "general.app_name",
    label: "Application name",
    description: "Display name shown in the browser tab and outgoing emails.",
    category: "general",
    type: "string",
    defaultValue: "Template App",
  },
  {
    key: "general.default_timezone",
    label: "Default timezone",
    description: "Timezone used when no user or tenant timezone is set.",
    category: "general",
    type: "string",
    defaultValue: "UTC",
  },

  // ─── Auth ────────────────────────────────────────
  {
    key: "auth.session_timeout_minutes",
    label: "Session timeout",
    description: "Minutes of inactivity before a session is considered expired.",
    category: "auth",
    type: "number",
    defaultValue: "480",
  },
  {
    key: "auth.inactivity_timeout_minutes",
    label: "Inactivity warning",
    description: "Minutes before showing the inactivity warning modal.",
    category: "auth",
    type: "number",
    defaultValue: "60",
  },
  {
    key: "auth.max_failed_attempts",
    label: "Max failed login attempts",
    description: "Number of wrong-password attempts before the account is locked.",
    category: "auth",
    type: "number",
    defaultValue: "5",
  },
  {
    key: "auth.lockout_duration_minutes",
    label: "Lockout duration",
    description: "Minutes the account stays locked after too many failed attempts.",
    category: "auth",
    type: "number",
    defaultValue: "30",
  },
  {
    key: "auth.password_expiry_days",
    label: "Password expiry",
    description: "Days before users must rotate their password (0 = never).",
    category: "auth",
    type: "number",
    defaultValue: "90",
  },
  {
    key: "auth.password_history_count",
    label: "Password history",
    description: "Number of previous password hashes that cannot be reused.",
    category: "auth",
    type: "number",
    defaultValue: "5",
  },

  // ─── Uploads ─────────────────────────────────────
  {
    key: "upload.max_file_size_mb",
    label: "Max upload size",
    description: "Largest file size (MB) accepted by the upload endpoint.",
    category: "upload",
    type: "number",
    defaultValue: "10",
  },
  {
    key: "upload.allowed_extensions",
    label: "Allowed file extensions",
    description: "Comma-separated list of allowed file extensions.",
    category: "upload",
    type: "string",
    defaultValue: "jpg,jpeg,png,gif,pdf,doc,docx",
  },

  // ─── Email ───────────────────────────────────────
  {
    key: "email.from_address",
    label: "From address",
    description: "Address outgoing email is sent from.",
    category: "email",
    type: "string",
    defaultValue: "noreply@example.com",
  },
  {
    key: "email.from_name",
    label: "From name",
    description: "Display name on outgoing email.",
    category: "email",
    type: "string",
    defaultValue: "Template App",
  },

  // ─── Audit ───────────────────────────────────────
  {
    key: "audit.retention_years",
    label: "Audit retention (years)",
    description: "How long audit log rows are retained before pruning.",
    category: "audit",
    type: "number",
    defaultValue: "7",
  },

  // ─── i18n ───────────────────────────────────────
  {
    key: "i18n.supported_languages",
    label: "Supported languages",
    description: "Comma-separated language codes offered to end-users (e.g. 'en,fr').",
    category: "i18n",
    type: "string",
    defaultValue: "en,fr",
  },

  // ─── Webhooks & notifications ───────────────────
  {
    key: "webhooks.max_subscriptions_per_tenant",
    label: "Max webhook subscriptions per tenant",
    description: "Hard cap on concurrent webhook subscriptions per tenant.",
    category: "integrations",
    type: "number",
    defaultValue: "10",
  },
  {
    key: "webhooks.default_max_retries",
    label: "Default webhook delivery retries",
    description: "How many times a delivery is retried before entering DEAD_LETTER.",
    category: "integrations",
    type: "number",
    defaultValue: "5",
  },
  {
    key: "notifications.retention_days",
    label: "Notification retention (days)",
    description: "How long in-app notifications are retained before pruning.",
    category: "notifications",
    type: "number",
    defaultValue: "90",
  },
];

/**
 * Derived map used by the settings service for quick default lookup. Keeping
 * this a single source (derived from SETTINGS_REGISTRY) avoids the drift
 * facilities has between its two registries.
 */
export const SETTING_DEFAULTS: Record<string, { value: string; type: string; category: string }> =
  Object.fromEntries(
    SETTINGS_REGISTRY.map((s) => [
      s.key,
      {
        value: s.defaultValue,
        type: s.type === "select" ? "string" : s.type,
        category: s.category,
      },
    ]),
  );

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_REGISTRY.find((s) => s.key === key);
}

export function getSettingCategories(): string[] {
  return Array.from(new Set(SETTINGS_REGISTRY.map((s) => s.category))).sort();
}
