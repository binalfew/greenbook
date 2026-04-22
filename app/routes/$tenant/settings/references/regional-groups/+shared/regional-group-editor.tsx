import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { getFormProps, getInputProps, getTextareaProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { regionalGroupFormSchema } from "./regional-group-schema";

type RegionalGroupLike = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};

export interface RegionalGroupEditorProps {
  regionalGroup?: RegionalGroupLike;
  actionData?: unknown;
  basePrefix: string;
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

export function RegionalGroupEditor({
  regionalGroup,
  actionData,
  basePrefix,
}: RegionalGroupEditorProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(regionalGroupFormSchema, {
    id: "regional-group-editor",
    lastResult: actionData,
    defaultValue: regionalGroup
      ? {
          id: regionalGroup.id,
          code: regionalGroup.code,
          name: regionalGroup.name,
          description: regionalGroup.description ?? "",
        }
      : { id: "", code: "", name: "", description: "" },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {regionalGroup && (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("regionalGroups")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={fields.code.id} label={t("code")} required errors={fields.code.errors}>
              <Input
                {...getInputProps(fields.code, { type: "text" })}
                key={fields.code.key}
                maxLength={20}
                placeholder="NORTH"
                className="uppercase"
              />
            </FieldRow>
            <FieldRow id={fields.name.id} label={t("name")} required errors={fields.name.errors}>
              <Input
                {...getInputProps(fields.name, { type: "text" })}
                key={fields.name.key}
                placeholder="Northern Africa"
              />
            </FieldRow>
          </div>
          <FieldRow
            id={fields.description.id}
            label={t("description")}
            errors={fields.description.errors}
          >
            <Textarea
              {...getTextareaProps(fields.description)}
              key={fields.description.key}
              rows={3}
            />
          </FieldRow>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="w-full sm:w-auto">
          {tc("save")}
        </Button>
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link to={basePrefix}>{tc("cancel")}</Link>
        </Button>
      </div>
    </Form>
  );
}
