import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import {
  SelectField,
  getFormProps,
  getInputProps,
  getSelectProps,
  getTextareaProps,
  useForm,
} from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { Textarea } from "~/components/ui/textarea";
import { noteFormSchema, noteStatusValues } from "~/utils/schemas/notes";
import type { Route } from "../$noteId_/+types/edit";

// Shared editor — mounted by both `new.tsx` and `$noteId_.edit.tsx`.
// The schema includes an optional `id`; the shared action upserts based on
// whether id is present. This keeps create/edit logic in one place.

type NoteLike = {
  id: string;
  title: string;
  content: string;
  status: string;
  categoryId: string | null;
  tags: string[];
  dueDate: Date | string | null;
};

export interface NoteEditorProps {
  note?: NoteLike;
  categories: Array<{ id: string; name: string; color: string | null }>;
  actionData?: Route.ComponentProps["actionData"];
  basePrefix: string;
}

function FieldRow({
  id,
  label,
  required,
  errors,
  help,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  errors?: string[];
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {help && <p className="text-muted-foreground text-xs">{help}</p>}
      {errors && errors.length > 0 && <p className="text-destructive text-sm">{errors[0]}</p>}
    </div>
  );
}

function formatDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function NoteEditor({ note, categories, actionData, basePrefix }: NoteEditorProps) {
  const { t } = useTranslation("notes");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(noteFormSchema, {
    lastResult: actionData,
    defaultValue: {
      id: note?.id ?? "",
      title: note?.title ?? "",
      content: note?.content ?? "",
      status: note?.status ?? "DRAFT",
      categoryId: note?.categoryId ?? "",
      tags: note?.tags?.join(", ") ?? "",
      dueDate: formatDateInput(note?.dueDate),
    },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {note?.id && <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("cardBasics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow id={fields.title.id} label={t("title")} required errors={fields.title.errors}>
            <Input
              {...getInputProps(fields.title, { type: "text" })}
              key={fields.title.key}
              placeholder={t("titlePlaceholder")}
            />
          </FieldRow>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow id={fields.status.id} label={t("status")} errors={fields.status.errors}>
              <NativeSelect {...getSelectProps(fields.status)} key={fields.status.key}>
                {noteStatusValues.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(`statuses.${value}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldRow>

            <FieldRow
              id={fields.categoryId.id}
              label={t("category")}
              errors={fields.categoryId.errors}
            >
              <SelectField
                meta={fields.categoryId}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={t("categoryPlaceholder")}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow id={fields.dueDate.id} label={t("dueDate")} errors={fields.dueDate.errors}>
              <Input
                {...getInputProps(fields.dueDate, { type: "date" })}
                key={fields.dueDate.key}
              />
            </FieldRow>

            <FieldRow
              id={fields.tags.id}
              label={t("tags")}
              help={t("tagsHelp")}
              errors={fields.tags.errors}
            >
              <Input
                {...getInputProps(fields.tags, { type: "text" })}
                key={fields.tags.key}
                placeholder="foo, bar, baz"
              />
            </FieldRow>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("cardContent")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldRow
            id={fields.content.id}
            label={t("content")}
            help={t("contentHelp")}
            errors={fields.content.errors}
          >
            <Textarea
              {...getTextareaProps(fields.content)}
              key={fields.content.key}
              rows={12}
              placeholder={t("contentPlaceholder")}
              className="font-mono text-sm"
            />
          </FieldRow>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="w-full sm:w-auto">
          {note ? tc("save") : t("create")}
        </Button>
        <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
          <Link to={note ? `${basePrefix}/${note.id}` : basePrefix}>{tc("cancel")}</Link>
        </Button>
      </div>
    </Form>
  );
}
