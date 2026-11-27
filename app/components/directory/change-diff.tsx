import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { FieldDiff } from "~/services/directory-changes.server";
import { personPhotoPath } from "~/utils/directory-routes";

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

// A person's `photoId` is shown as the picture itself. The old photo is
// deleted once a replacement is approved, hence the fallback.
function PhotoValue({ id }: { id: unknown }) {
  const { t } = useTranslation("directory");
  const { tenant = "" } = useParams();
  const [failed, setFailed] = useState(false);

  if (typeof id !== "string" || id === "") return renderValue(null);
  if (failed) {
    return <span className="text-muted-foreground italic">{t("people.photo.unavailable")}</span>;
  }
  return (
    <img
      src={personPhotoPath(tenant, id)}
      alt={t("people.fields.photo")}
      width={96}
      height={96}
      className="size-24 rounded-md border object-cover"
      onError={() => setFailed(true)}
    />
  );
}

// Diff rows carry raw column names. The editors already have a label for
// almost all of them, so reuse those; anything unknown is spelled out.
const FIELD_ALIASES: Record<string, string> = { parentId: "parent", reportsToId: "reportsTo" };
const FIELD_GROUPS = ["people", "organizations", "positions", "assignments"] as const;

function useFieldLabel() {
  const { t, i18n } = useTranslation("directory");
  return (field: string) => {
    const name = FIELD_ALIASES[field] ?? field.replace(/Id$/, "");
    for (const group of FIELD_GROUPS) {
      const key = `${group}.fields.${name}`;
      if (i18n.exists(key, { ns: "directory" })) return t(key);
    }
    const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
}

function DiffValue({ field, value }: { field: string; value: unknown }) {
  return field === "photoId" ? <PhotoValue id={value} /> : renderValue(value);
}

export function ChangeDiff({ diffs }: { diffs: FieldDiff[] }) {
  const { t } = useTranslation("directory");
  const fieldLabel = useFieldLabel();

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
          <dt className="text-muted-foreground text-xs font-medium">{fieldLabel(d.field)}</dt>
          <dd className="text-muted-foreground line-through decoration-rose-500">
            <DiffValue field={d.field} value={d.before} />
          </dd>
          <dd className="font-medium">
            <DiffValue field={d.field} value={d.after} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
