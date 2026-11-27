import { z } from "zod";
import i18n, { initI18n } from "~/utils/i18n";

/**
 * Plain-language validation messages for every form.
 *
 * Zod's built-in messages describe the data ("Invalid input: expected string,
 * received undefined"), which means nothing to someone filling in a form. This
 * replaces them globally with wording from the `validation` locale namespace,
 * in the active language. A message written on a schema itself
 * (`z.string().min(1, "…")`, `.refine(…, "…")`) still wins.
 *
 * Imported for its side effect by `entry.client.tsx` and `entry.server.tsx`.
 */

type Issue = Parameters<NonNullable<ReturnType<typeof z.config>["customError"]>>[0];

function t(key: string, options?: Record<string, unknown>): string {
  if (!i18n.isInitialized) initI18n();
  return i18n.t(key, { ns: "validation", ...options });
}

/** Conform turns an empty input into `undefined`, so "missing" means "left blank". */
function isBlank(input: unknown): boolean {
  return input === undefined || input === null || input === "";
}

function sizeMessage(issue: Issue, kind: "tooSmall" | "tooBig"): string {
  const limit = Number(kind === "tooSmall" ? issue.minimum : issue.maximum);
  const inclusive = issue.inclusive !== false;
  switch (issue.origin) {
    case "string":
      if (kind === "tooSmall" && limit <= 1 && isBlank(issue.input)) return t("required");
      return t(kind === "tooSmall" ? "stringTooShort" : "stringTooLong", { count: limit });
    case "array":
    case "set":
      return t(kind === "tooSmall" ? "tooFewItems" : "tooManyItems", { count: limit });
    case "file":
      return t(kind === "tooSmall" ? "fileTooSmall" : "fileTooLarge");
    case "date":
      return t(kind === "tooSmall" ? "dateTooEarly" : "dateTooLate");
    default:
      if (kind === "tooSmall") {
        return t(inclusive ? "numberMin" : "numberMoreThan", { value: limit });
      }
      return t(inclusive ? "numberMax" : "numberLessThan", { value: limit });
  }
}

function formatMessage(format: unknown): string {
  switch (format) {
    case "email":
      return t("emailInvalid");
    case "url":
      return t("urlInvalid");
    case "date":
    case "datetime":
    case "time":
      return t("dateInvalid");
    default:
      return t("formatInvalid");
  }
}

export function validationMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      if (isBlank(issue.input)) return t("required");
      if (issue.expected === "number" || issue.expected === "int" || issue.expected === "bigint") {
        return t("numberInvalid");
      }
      if (issue.expected === "date") return t("dateInvalid");
      return t("invalid");
    case "too_small":
      return sizeMessage(issue, "tooSmall");
    case "too_big":
      return sizeMessage(issue, "tooBig");
    case "invalid_format":
      return formatMessage(issue.format);
    case "invalid_value":
      return isBlank(issue.input) ? t("required") : t("optionInvalid");
    case "not_multiple_of":
      return t("notMultipleOf", { value: Number(issue.divisor) });
    default:
      return t("invalid");
  }
}

z.config({ customError: validationMessage });
