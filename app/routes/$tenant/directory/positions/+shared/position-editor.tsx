import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import {
  SelectField,
  SwitchField,
  getFormProps,
  getInputProps,
  getTextareaProps,
  useForm,
} from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { positionFormSchema } from "~/utils/schemas/directory";
import type { Route } from "../$positionId_/+types/edit";

type PositionLike = {
  id: string;
  organizationId: string;
  typeId: string;
  title: string;
  reportsToId: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
};

export interface PositionEditorProps {
  position?: PositionLike;
  organizations: Array<{ id: string; name: string; acronym: string | null }>;
  types: Array<{ id: string; name: string; code: string }>;
  reportsToCandidates: Array<{ id: string; title: string }>;
  canDirectApply: boolean;
  basePrefix: string;
  actionData?: Route.ComponentProps["actionData"];
}

function FieldRow({
  id,
  label,
  required,
  errors,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {errors && errors.length > 0 && <p className="text-destructive text-sm">{errors[0]}</p>}
    </div>
  );
}

export function PositionEditor({
  position,
  organizations,
  types,
  reportsToCandidates,
  canDirectApply,
  basePrefix,
  actionData,
}: PositionEditorProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(positionFormSchema, {
    lastResult: actionData,
    defaultValue: {
      id: position?.id ?? "",
      organizationId: position?.organizationId ?? "",
      typeId: position?.typeId ?? "",
      title: position?.title ?? "",
      reportsToId: position?.reportsToId ?? "",
      description: position?.description ?? "",
      isActive: position ? position.isActive : true,
      sortOrder: position?.sortOrder ?? 0,
    },
  });

  const cancelHref = position ? `${basePrefix}/${position.id}` : basePrefix;
  const submitLabel = canDirectApply
    ? t("actions.submitAndApprove")
    : position
      ? t("actions.submitAndEdit")
      : t("actions.submit");

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {position?.id ? (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("positions.cards.basics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow
            id={fields.title.id}
            label={t("positions.fields.title")}
            required
            errors={fields.title.errors}
          >
            <Input
              {...getInputProps(fields.title, { type: "text" })}
              key={fields.title.key}
              placeholder={t("positions.fields.titlePlaceholder")}
            />
          </FieldRow>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.organizationId.id}
              label={t("positions.fields.organization")}
              required
              errors={fields.organizationId.errors}
            >
              <SelectField
                meta={fields.organizationId}
                options={organizations.map((o) => ({
                  value: o.id,
                  label: o.acronym ? `${o.name} (${o.acronym})` : o.name,
                }))}
                placeholder={t("positions.fields.organizationPlaceholder")}
              />
            </FieldRow>
            <FieldRow
              id={fields.typeId.id}
              label={t("positions.fields.type")}
              required
              errors={fields.typeId.errors}
            >
              <SelectField
                meta={fields.typeId}
                options={types.map((ty) => ({ value: ty.id, label: ty.name }))}
                placeholder={t("positions.fields.typePlaceholder")}
              />
            </FieldRow>
          </div>

          <FieldRow
            id={fields.reportsToId.id}
            label={t("positions.fields.reportsTo")}
            errors={fields.reportsToId.errors}
          >
            <SelectField
              meta={fields.reportsToId}
              options={reportsToCandidates
                .filter((p) => !position || p.id !== position.id)
                .map((p) => ({ value: p.id, label: p.title }))}
              placeholder={t("positions.fields.reportsToPlaceholder")}
            />
          </FieldRow>

          <FieldRow
            id={fields.description.id}
            label={t("positions.fields.description")}
            errors={fields.description.errors}
          >
            <Textarea
              {...getTextareaProps(fields.description)}
              key={fields.description.key}
              rows={4}
            />
          </FieldRow>

          <div className="flex items-center gap-3">
            <SwitchField meta={fields.isActive} />
            <Label htmlFor={fields.isActive.id}>{t("positions.fields.isActive")}</Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="w-full sm:w-auto">
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
          <Link to={cancelHref}>{tc("cancel")}</Link>
        </Button>
      </div>
    </Form>
  );
}
