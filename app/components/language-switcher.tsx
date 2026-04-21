import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { supportedLanguages, type SupportedLanguage } from "~/utils/i18n";

type LanguageSwitcherProps = {
  /** Current active language (resolved from the cookie server-side). */
  currentLanguage: SupportedLanguage;
  /**
   * Optional allowlist of language codes the tenant has enabled. Defaults to
   * all supported languages.
   */
  allowed?: readonly string[];
  className?: string;
};

/**
 * Small form-based language picker. On change, submits to
 * `/resources/language-switch` which sets the `i18n_lang` cookie and redirects
 * back. This avoids needing any client-side state for the picker itself.
 */
export function LanguageSwitcher({ currentLanguage, allowed, className }: LanguageSwitcherProps) {
  const { t } = useTranslation("common");
  const location = useLocation();
  const redirectTo = `${location.pathname}${location.search}`;

  const options = allowed
    ? supportedLanguages.filter((l) => allowed.includes(l.code))
    : supportedLanguages;

  if (options.length <= 1) return null;

  return (
    <form method="post" action="/resources/language-switch" className={className}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label className="sr-only" htmlFor="lang-select">
        {t("language")}
      </label>
      <select
        id="lang-select"
        name="lang"
        defaultValue={currentLanguage}
        onChange={(e) => e.currentTarget.form?.submit()}
        className="rounded border bg-transparent px-2 py-1 text-sm"
      >
        {options.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="ml-2 rounded border px-2 py-1 text-sm">
          {t("save")}
        </button>
      </noscript>
    </form>
  );
}
