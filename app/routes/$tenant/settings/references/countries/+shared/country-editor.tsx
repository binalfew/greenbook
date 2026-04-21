import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SwitchField, getFormProps, getInputProps, useForm } from "~/components/form";
import { countryFormSchema } from "./country-schema";

type CountryLike = {
  id: string;
  code: string;
  name: string;
  alpha3: string | null;
  numericCode: string | null;
  phoneCode: string | null;
  flag: string | null;
  sortOrder: number;
  isActive: boolean;
};

export interface CountryEditorProps {
  country?: CountryLike;
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

export function CountryEditor({ country, actionData, basePrefix }: CountryEditorProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(countryFormSchema, {
    id: "country-editor",
    lastResult: actionData,
    defaultValue: country
      ? {
          id: country.id,
          code: country.code,
          name: country.name,
          alpha3: country.alpha3 ?? "",
          numericCode: country.numericCode ?? "",
          phoneCode: country.phoneCode ?? "",
          flag: country.flag ?? "",
          sortOrder: country.sortOrder,
          isActive: country.isActive,
        }
      : {
          id: "",
          code: "",
          name: "",
          alpha3: "",
          numericCode: "",
          phoneCode: "",
          flag: "",
          sortOrder: 0,
          isActive: true,
        },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {country && <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("countries")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={fields.code.id} label={t("code")} required errors={fields.code.errors}>
              <Input
                {...getInputProps(fields.code, { type: "text" })}
                key={fields.code.key}
                maxLength={2}
                placeholder="US"
                className="uppercase"
              />
            </FieldRow>
            <FieldRow id={fields.name.id} label={t("name")} required errors={fields.name.errors}>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow id={fields.alpha3.id} label={t("alpha3")} errors={fields.alpha3.errors}>
              <Input
                {...getInputProps(fields.alpha3, { type: "text" })}
                key={fields.alpha3.key}
                maxLength={3}
                placeholder="USA"
                className="uppercase"
              />
            </FieldRow>
            <FieldRow
              id={fields.numericCode.id}
              label={t("numericCode")}
              errors={fields.numericCode.errors}
            >
              <Input
                {...getInputProps(fields.numericCode, { type: "text" })}
                key={fields.numericCode.key}
                maxLength={3}
              />
            </FieldRow>
            <FieldRow
              id={fields.phoneCode.id}
              label={t("phoneCode")}
              errors={fields.phoneCode.errors}
            >
              <Input
                {...getInputProps(fields.phoneCode, { type: "text" })}
                key={fields.phoneCode.key}
                placeholder="+1"
              />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={fields.flag.id} label={t("flag")} errors={fields.flag.errors}>
              <Input
                {...getInputProps(fields.flag, { type: "text" })}
                key={fields.flag.key}
                placeholder="🇺🇸"
              />
            </FieldRow>
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
          </div>
          <label className="flex items-center gap-2 text-sm">
            <SwitchField meta={fields.isActive} />
            {t("isActive")}
          </label>
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
