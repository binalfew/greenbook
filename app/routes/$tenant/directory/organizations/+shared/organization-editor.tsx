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
import { formatDateInput } from "~/utils/format-date";
import { organizationFormSchema } from "~/utils/schemas/directory";
import type { Route } from "../$orgId_/+types/edit";

type OrgLike = {
  id: string;
  name: string;
  acronym: string | null;
  typeId: string;
  parentId: string | null;
  description: string | null;
  mandate: string | null;
  establishmentDate: Date | string | null;
  isActive: boolean;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  sortOrder: number;
};

export interface OrganizationEditorProps {
  org?: OrgLike;
  types: Array<{ id: string; name: string; code: string; level: number }>;
  parents: Array<{ id: string; name: string; acronym: string | null }>;
  canDirectApply: boolean;
  basePrefix: string;
  actionData?: Route.ComponentProps["actionData"];
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

export function OrganizationEditor({
  org,
  types,
  parents,
  canDirectApply,
  basePrefix,
  actionData,
}: OrganizationEditorProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(organizationFormSchema, {
    lastResult: actionData,
    defaultValue: {
      id: org?.id ?? "",
      name: org?.name ?? "",
      acronym: org?.acronym ?? "",
      typeId: org?.typeId ?? "",
      parentId: org?.parentId ?? "",
      description: org?.description ?? "",
      mandate: org?.mandate ?? "",
      establishmentDate: formatDateInput(org?.establishmentDate),
      isActive: org ? org.isActive : true,
      website: org?.website ?? "",
      email: org?.email ?? "",
      phone: org?.phone ?? "",
      address: org?.address ?? "",
      sortOrder: org?.sortOrder ?? 0,
    },
  });

  const cancelHref = org ? `${basePrefix}/${org.id}` : basePrefix;
  const submitLabel = canDirectApply
    ? t("actions.submitAndApprove")
    : org
      ? t("actions.submitAndEdit")
      : t("actions.submit");

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {org?.id ? (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("organizations.cards.basics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
            <FieldRow
              id={fields.name.id}
              label={t("organizations.fields.name")}
              required
              errors={fields.name.errors}
            >
              <Input
                {...getInputProps(fields.name, { type: "text" })}
                key={fields.name.key}
                placeholder={t("organizations.fields.namePlaceholder")}
              />
            </FieldRow>

            <FieldRow
              id={fields.acronym.id}
              label={t("organizations.fields.acronym")}
              errors={fields.acronym.errors}
            >
              <Input
                {...getInputProps(fields.acronym, { type: "text" })}
                key={fields.acronym.key}
                placeholder={t("organizations.fields.acronymPlaceholder")}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.typeId.id}
              label={t("organizations.fields.type")}
              required
              errors={fields.typeId.errors}
            >
              <NativeSelect {...getSelectProps(fields.typeId)} key={fields.typeId.key}>
                <NativeSelectOption value="">
                  {t("organizations.fields.typePlaceholder")}
                </NativeSelectOption>
                {types.map((ty) => (
                  <NativeSelectOption key={ty.id} value={ty.id}>
                    {ty.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldRow>

            <FieldRow
              id={fields.parentId.id}
              label={t("organizations.fields.parent")}
              errors={fields.parentId.errors}
            >
              <SelectField
                meta={fields.parentId}
                options={parents
                  .filter((p) => !org || p.id !== org.id)
                  .map((p) => ({
                    value: p.id,
                    label: p.acronym ? `${p.name} (${p.acronym})` : p.name,
                  }))}
                placeholder={t("organizations.fields.parentPlaceholder")}
              />
            </FieldRow>
          </div>

          <FieldRow
            id={fields.description.id}
            label={t("organizations.fields.description")}
            errors={fields.description.errors}
          >
            <Textarea
              {...getTextareaProps(fields.description)}
              key={fields.description.key}
              rows={3}
            />
          </FieldRow>

          <FieldRow
            id={fields.mandate.id}
            label={t("organizations.fields.mandate")}
            errors={fields.mandate.errors}
          >
            <Textarea {...getTextareaProps(fields.mandate)} key={fields.mandate.key} rows={4} />
          </FieldRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            {t("organizations.cards.contact")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.website.id}
              label={t("organizations.fields.website")}
              errors={fields.website.errors}
            >
              <Input
                {...getInputProps(fields.website, { type: "url" })}
                key={fields.website.key}
                placeholder="https://"
              />
            </FieldRow>
            <FieldRow
              id={fields.email.id}
              label={t("organizations.fields.email")}
              errors={fields.email.errors}
            >
              <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
            </FieldRow>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.phone.id}
              label={t("organizations.fields.phone")}
              errors={fields.phone.errors}
            >
              <Input {...getInputProps(fields.phone, { type: "tel" })} key={fields.phone.key} />
            </FieldRow>
            <FieldRow
              id={fields.establishmentDate.id}
              label={t("organizations.fields.establishmentDate")}
              errors={fields.establishmentDate.errors}
            >
              <Input
                {...getInputProps(fields.establishmentDate, { type: "date" })}
                key={fields.establishmentDate.key}
              />
            </FieldRow>
          </div>
          <FieldRow
            id={fields.address.id}
            label={t("organizations.fields.address")}
            errors={fields.address.errors}
          >
            <Textarea {...getTextareaProps(fields.address)} key={fields.address.key} rows={2} />
          </FieldRow>
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
