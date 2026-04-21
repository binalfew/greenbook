// Shared date formatting used by every detail + form route. Kept in a
// single file so a future i18n-aware formatter can drop in without
// rewriting every consumer.

const DASH = "—";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return DASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString();
}

// Input[type="date"]-ready string (YYYY-MM-DD). Empty string for null/
// invalid input so the control renders blank rather than "Invalid Date".
export function formatDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
