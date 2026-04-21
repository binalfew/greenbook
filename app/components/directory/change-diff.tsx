import { useTranslation } from "react-i18next";
import type { FieldDiff } from "~/services/directory-changes.server";

// Renders a ChangeRequest's field-level diff as a vertical list: each row
// shows the field name + the before-value (struck through) + the after-value.
// CREATE changes have `before: null`, DELETE changes surface just the reason
// — both are handled uniformly because `computeDiff` normalises the shape.

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "")
    return <span className="text-muted-foreground italic">—</span>;
  if (typeof v === "boolean") return v ? "✓" : "—";
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v))
    return v.length > 0 ? v.join(", ") : <span className="text-muted-foreground italic">—</span>;
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "object") {
    try {
      return <code className="text-xs">{JSON.stringify(v)}</code>;
    } catch {
      // Defensive: JSON.stringify throws on circular refs or BigInt inside objects.
      return <code className="text-xs">[unserializable]</code>;
    }
  }
  return String(v);
}

export function ChangeDiff({ diffs }: { diffs: FieldDiff[] }) {
  const { t } = useTranslation("directory");

  if (diffs.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("changes.beforeAfter.empty")}</p>;
  }

  return (
    <dl className="divide-y">
      {diffs.map((d) => (
        <div
          key={d.field}
          className="grid grid-cols-1 gap-2 py-3 text-sm md:grid-cols-[8rem_1fr_1fr]"
        >
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {d.field}
          </dt>
          <dd className="text-muted-foreground line-through decoration-rose-500">
            {renderValue(d.before)}
          </dd>
          <dd className="font-medium">{renderValue(d.after)}</dd>
        </div>
      ))}
    </dl>
  );
}
