import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { FieldDiff } from "~/services/directory-changes.server";
import { personPhotoPath } from "~/utils/directory-routes";
import { formatDate } from "~/utils/format-date";
import type { ChangeOperationKey, DirectoryEntityKey } from "~/utils/schemas/directory";

// Renders a ChangeRequest's fields. A new record is a summary laid out like
// its editor form (one value per field, empty ones left out); an edit is a
// list of field / before (struck through) / after. DELETE changes surface
// just the reason — `computeDiff` normalises all three to the same shape.

type Translate = (key: string, options?: Record<string, unknown>) => string;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function renderValue(field: string, v: unknown, tc: Translate): React.ReactNode {
  if (isEmpty(v)) return <span className="text-muted-foreground italic">—</span>;
  if (typeof v === "boolean") return v ? tc("yes") : tc("no");
  if (typeof v === "bigint") return v.toString();
  if (field === "languages" && Array.isArray(v)) {
    return v.map((code) => tc(`languageNames.${code}`, { defaultValue: String(code) })).join(", ");
  }
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "string" && /Date$/.test(field)) return formatDate(v);
  if (typeof v === "object") {
    try {
      return <code className="text-xs">{JSON.stringify(v)}</code>;
    } catch {
      // Defensive: JSON.stringify throws on circular refs or BigInt inside objects.
      return <code className="text-xs">[unserializable]</code>;
    }
  }
  return <span className="break-words whitespace-pre-wrap">{String(v)}</span>;
}

// A person's `photoId` is shown as the picture itself. The old photo is
// deleted once a replacement is approved, hence the fallback.
function PhotoValue({ id }: { id: unknown }) {
  const { t } = useTranslation("directory");
  const { tenant = "" } = useParams();
  const [failed, setFailed] = useState(false);

  if (typeof id !== "string" || id === "") {
    return <span className="text-muted-foreground italic">—</span>;
  }
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
// A new person's first position is labelled like the assignment it becomes.
const FIELD_KEYS: Record<string, string> = {
  initialPositionId: "assignments.fields.position",
  initialStartDate: "assignments.fields.startDate",
  initialNotes: "assignments.fields.notes",
};
const ENTITY_GROUP: Record<DirectoryEntityKey, string> = {
  PERSON: "people",
  ORGANIZATION: "organizations",
  POSITION: "positions",
  POSITION_ASSIGNMENT: "assignments",
};
const FIELD_GROUPS = ["people", "organizations", "positions", "assignments"];

function useFieldLabel(entityType: DirectoryEntityKey) {
  const { t, i18n } = useTranslation("directory");
  return (field: string) => {
    const fixed = FIELD_KEYS[field];
    if (fixed) return t(fixed);
    const name = FIELD_ALIASES[field] ?? field.replace(/Id$/, "");
    // The record's own labels first: "Title" means different things on a
    // person and on a position.
    for (const group of [ENTITY_GROUP[entityType], ...FIELD_GROUPS]) {
      const key = `${group}.fields.${name}`;
      if (i18n.exists(key, { ns: "directory" })) return t(key);
    }
    const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
}

// The sections of each editor form, in form order. A field no section lists
// still shows, in a last untitled section.
const SECTIONS: Record<DirectoryEntityKey, Array<{ titleKey?: string; fields: string[] }>> = {
  PERSON: [
    {
      titleKey: "people.cards.basics",
      fields: [
        "honorific",
        "firstName",
        "lastName",
        "memberStateId",
        "photoId",
        "languages",
        "bio",
      ],
    },
    {
      titleKey: "people.cards.contact",
      fields: ["email", "showEmail", "phone", "showPhone", "officeEmail", "officePhone"],
    },
    {
      titleKey: "people.cards.initialAssignment",
      fields: ["initialPositionId", "initialStartDate", "initialNotes"],
    },
  ],
  ORGANIZATION: [
    {
      titleKey: "organizations.cards.basics",
      fields: [
        "name",
        "acronym",
        "typeId",
        "parentId",
        "establishmentDate",
        "isActive",
        "sortOrder",
        "description",
        "mandate",
      ],
    },
    { titleKey: "organizations.cards.contact", fields: ["website", "email", "phone", "address"] },
  ],
  POSITION: [
    {
      titleKey: "positions.cards.basics",
      fields: ["title", "organizationId", "typeId", "description", "isActive", "sortOrder"],
    },
    { titleKey: "positions.cards.reporting", fields: ["reportsToId"] },
  ],
  POSITION_ASSIGNMENT: [{ fields: ["personId", "positionId", "startDate", "endDate", "notes"] }],
};

function sectionsFor(entityType: DirectoryEntityKey, diffs: FieldDiff[]) {
  const byField = new Map(diffs.filter((d) => !isEmpty(d.after)).map((d) => [d.field, d]));
  const sections = SECTIONS[entityType].map((section) => ({
    titleKey: section.titleKey,
    rows: section.fields.flatMap((field) => {
      const row = byField.get(field);
      byField.delete(field);
      return row ? [row] : [];
    }),
  }));
  sections.push({ titleKey: undefined, rows: [...byField.values()] });
  return sections.filter((section) => section.rows.length > 0);
}

function DiffValue({ field, value }: { field: string; value: unknown }) {
  const { t: tc } = useTranslation("common");
  return field === "photoId" ? <PhotoValue id={value} /> : renderValue(field, value, tc);
}

export function ChangeDiff({
  diffs,
  entityType,
  operation,
}: {
  diffs: FieldDiff[];
  entityType: DirectoryEntityKey;
  operation: ChangeOperationKey;
}) {
  const { t } = useTranslation("directory");
  const fieldLabel = useFieldLabel(entityType);

  // A new record is one card per section of its form.
  if (operation === "CREATE" && diffs.length > 0) {
    return (
      <>
        {sectionsFor(entityType, diffs).map((section, index) => (
          <Card key={section.titleKey ?? index}>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {t(section.titleKey ?? "changes.beforeAfter.createTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                {section.rows.map((d) => (
                  <div
                    key={d.field}
                    className="grid grid-cols-1 gap-1 py-2.5 text-sm md:grid-cols-[12rem_1fr] md:gap-4"
                  >
                    <dt className="text-muted-foreground">{fieldLabel(d.field)}</dt>
                    <dd className="min-w-0 font-medium">
                      <DiffValue field={d.field} value={d.after} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t("changes.beforeAfter.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {diffs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("changes.beforeAfter.empty")}</p>
        ) : (
          <ChangedFields diffs={diffs} entityType={entityType} />
        )}
      </CardContent>
    </Card>
  );
}

function ChangedFields({
  diffs,
  entityType,
}: {
  diffs: FieldDiff[];
  entityType: DirectoryEntityKey;
}) {
  const { t } = useTranslation("directory");
  const fieldLabel = useFieldLabel(entityType);
  return (
    <dl className="divide-y">
      <div className="text-muted-foreground hidden gap-4 pb-2 text-xs font-semibold tracking-wide uppercase md:grid md:grid-cols-[12rem_1fr_1fr]">
        <span>{t("changes.beforeAfter.field")}</span>
        <span>{t("changes.beforeAfter.before")}</span>
        <span>{t("changes.beforeAfter.after")}</span>
      </div>
      {diffs.map((d) => (
        <div
          key={d.field}
          className="grid grid-cols-1 gap-2 py-3 text-sm md:grid-cols-[12rem_1fr_1fr] md:gap-4"
        >
          <dt className="text-muted-foreground">{fieldLabel(d.field)}</dt>
          <dd className="text-muted-foreground min-w-0 line-through decoration-rose-500">
            <DiffValue field={d.field} value={d.before} />
          </dd>
          <dd className="min-w-0 font-medium">
            <DiffValue field={d.field} value={d.after} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
