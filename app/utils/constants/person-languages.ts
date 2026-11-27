// The languages a person record can list: the African Union's working
// languages, as ISO 639-1 codes. Their display names are the
// `languageNames.<code>` keys of the `common` namespace.
export const PERSON_LANGUAGES = ["ar", "en", "fr", "pt", "es", "sw"] as const;

export type PersonLanguage = (typeof PERSON_LANGUAGES)[number];
