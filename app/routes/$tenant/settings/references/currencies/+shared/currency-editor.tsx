import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SwitchField, getFormProps, getInputProps, useForm } from "~/components/form";
import { currencyFormSchema } from "./currency-schema";

type CurrencyLike = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalDigits: number;
  sortOrder: number;
  isActive: boolean;
};

export interface CurrencyEditorProps {
  currency?: CurrencyLike;
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

export function CurrencyEditor({ currency, actionData, basePrefix }: CurrencyEditorProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(currencyFormSchema, {
    id: "currency-editor",
    lastResult: actionData,
    defaultValue: currency
      ? {
          id: currency.id,
          code: currency.code,
          name: currency.name,
          symbol: currency.symbol ?? "",
          decimalDigits: currency.decimalDigits,
          sortOrder: currency.sortOrder,
          isActive: currency.isActive,
        }
      : {
          id: "",
          code: "",
          name: "",
          symbol: "",
          decimalDigits: 2,
          sortOrder: 0,
          isActive: true,
        },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {currency && <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("currencies")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={fields.code.id} label={t("code")} required errors={fields.code.errors}>
              <Input
                {...getInputProps(fields.code, { type: "text" })}
                key={fields.code.key}
                maxLength={3}
                placeholder="USD"
                className="uppercase"
              />
            </FieldRow>
            <FieldRow id={fields.name.id} label={t("name")} required errors={fields.name.errors}>
              <Input {...getInputProps(fields.name, { type: "text" })} key={fields.name.key} />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow id={fields.symbol.id} label={t("symbol")} errors={fields.symbol.errors}>
              <Input
                {...getInputProps(fields.symbol, { type: "text" })}
                key={fields.symbol.key}
                placeholder="$"
              />
            </FieldRow>
            <FieldRow
              id={fields.decimalDigits.id}
              label={t("decimalDigits")}
              errors={fields.decimalDigits.errors}
            >
              <Input
                {...getInputProps(fields.decimalDigits, { type: "number" })}
                key={fields.decimalDigits.key}
                min={0}
                max={10}
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
