import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// English namespaces
import enCommon from "~/locales/en/common.json";
import enAuth from "~/locales/en/auth.json";
import enValidation from "~/locales/en/validation.json";
import enNav from "~/locales/en/nav.json";
import enSettings from "~/locales/en/settings.json";
import enUsers from "~/locales/en/users.json";
import enNotifications from "~/locales/en/notifications.json";
import enWebhooks from "~/locales/en/webhooks.json";
import enReferences from "~/locales/en/references.json";
import enLogs from "~/locales/en/logs.json";
import enSso from "~/locales/en/sso.json";
import enPwa from "~/locales/en/pwa.json";
import enNotes from "~/locales/en/notes.json";
import enDirectory from "~/locales/en/directory.json";
import enDirectoryPublic from "~/locales/en/directory-public.json";

// French namespaces
import frCommon from "~/locales/fr/common.json";
import frAuth from "~/locales/fr/auth.json";
import frValidation from "~/locales/fr/validation.json";
import frNav from "~/locales/fr/nav.json";
import frSettings from "~/locales/fr/settings.json";
import frUsers from "~/locales/fr/users.json";
import frNotifications from "~/locales/fr/notifications.json";
import frWebhooks from "~/locales/fr/webhooks.json";
import frReferences from "~/locales/fr/references.json";
import frLogs from "~/locales/fr/logs.json";
import frSso from "~/locales/fr/sso.json";
import frPwa from "~/locales/fr/pwa.json";
import frNotes from "~/locales/fr/notes.json";
import frDirectory from "~/locales/fr/directory.json";
import frDirectoryPublic from "~/locales/fr/directory-public.json";

/**
 * Languages the template ships with. Add new entries here AND register the
 * corresponding JSON files in the `resources` map below.
 */
export const supportedLanguages = [
  { code: "en", name: "English", dir: "ltr" as const },
  { code: "fr", name: "Français", dir: "ltr" as const },
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number]["code"];

export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return supportedLanguages.some((l) => l.code === code);
}

/**
 * Best-effort text direction lookup. Currently no RTL locales ship by default,
 * but new locales like Arabic should add themselves here.
 */
export function getLanguageDir(lang: string): "ltr" | "rtl" {
  return ["ar", "he", "fa", "ur"].includes(lang) ? "rtl" : "ltr";
}

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    validation: enValidation,
    nav: enNav,
    settings: enSettings,
    users: enUsers,
    notifications: enNotifications,
    webhooks: enWebhooks,
    references: enReferences,
    logs: enLogs,
    sso: enSso,
    pwa: enPwa,
    notes: enNotes,
    directory: enDirectory,
    "directory-public": enDirectoryPublic,
  },
  fr: {
    common: frCommon,
    auth: frAuth,
    validation: frValidation,
    nav: frNav,
    settings: frSettings,
    users: frUsers,
    notifications: frNotifications,
    webhooks: frWebhooks,
    references: frReferences,
    logs: frLogs,
    sso: frSso,
    pwa: frPwa,
    notes: frNotes,
    directory: frDirectory,
    "directory-public": frDirectoryPublic,
  },
};

export const NAMESPACES = [
  "common",
  "auth",
  "validation",
  "nav",
  "settings",
  "users",
  "notifications",
  "webhooks",
  "references",
  "logs",
  "sso",
  "pwa",
  "notes",
  "directory",
  "directory-public",
] as const;

let initialized = false;

/**
 * Initialise i18next once. Safe to call multiple times — subsequent calls only
 * change the active language if it differs.
 */
export function initI18n(language?: string) {
  if (initialized) {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
    return i18n;
  }

  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: "en",
      defaultNS: "common",
      ns: [...NAMESPACES],
      ...(language ? { lng: language } : {}),
      detection: {
        order: ["cookie", "navigator"],
        lookupCookie: "i18n_lang",
        caches: ["cookie"],
        cookieMinutes: 60 * 24 * 365, // 1 year
      },
      interpolation: {
        escapeValue: false, // React already escapes
      },
      parseMissingKeyHandler: (key) => key,
    });

  initialized = true;
  return i18n;
}

export default i18n;
