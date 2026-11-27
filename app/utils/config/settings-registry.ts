/**
 * Catalogue of the system settings Greenbook reads. Drives the admin UI
 * (labels, types, options) and the default fallback when no DB row exists.
 *
 * Only list a key here once some code reads it: the settings screen shows
 * exactly this list, so an unread key would be a control that does nothing.
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
  {
    key: "i18n.supported_languages",
    label: "Supported languages",
    description: "Comma-separated language codes offered to end-users (e.g. 'en,fr').",
    category: "i18n",
    type: "string",
    defaultValue: "en,fr",
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
