import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SwitchField, getFormProps, getInputProps, useForm } from "~/components/form";
import { titleFormSchema } from "./title-schema";

type TitleLike = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export interface TitleEditorProps {
  title?: TitleLike;
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

export function TitleEditor({ title, actionData, basePrefix }: TitleEditorProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(titleFormSchema, {
    id: "title-editor",
    lastResult: actionData,
    defaultValue: title
      ? {
          id: title.id,
          code: title.code,
          name: title.name,
          sortOrder: title.sortOrder,
          isActive: title.isActive,
        }
      : { id: "", code: "", name: "", sortOrder: 0, isActive: true },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {title && <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("titles")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={fields.code.id} label={t("code")} required errors={fields.code.errors}>
              <Input
                {...getInputProps(fields.code, { type: "text" })}
                key={fields.code.key}
                maxLength={20}
                placeholder="MR"
                className="uppercase"
              />
            </FieldRow>
            <FieldRow id={fields.name.id} label={t("name")} required errors={fields.name.errors}>
              <Input
                {...getInputProps(fields.name, { type: "text" })}
                key={fields.name.key}
                placeholder="Mr."
              />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow
              id={fields.sortOrder.id}
              label={t("sortOrder")}
              errors={fields.sortOrder.errors}
            >
              <Input
                {...getInputProps(fields.sortOrder, { type: "number" })}
                key={fields.sortOrder.key}
                min={0}
              />
            </FieldRow>
            <label className="flex items-center gap-2 self-end text-sm">
              <SwitchField meta={fields.isActive} />
              {t("isActive")}
            </label>
          </div>
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
