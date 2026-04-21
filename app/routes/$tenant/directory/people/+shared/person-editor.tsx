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
import { personFormSchema } from "~/utils/schemas/directory";
import type { Route } from "../$personId_/+types/edit";

type PersonLike = {
  id: string;
  firstName: string;
  lastName: string;
  honorific: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  photoUrl: string | null;
  memberStateId: string | null;
  languages: string[];
  showEmail: boolean;
  showPhone: boolean;
};

export interface PersonEditorProps {
  person?: PersonLike;
  memberStates: Array<{ id: string; fullName: string; abbreviation: string }>;
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

export function PersonEditor({
  person,
  memberStates,
  canDirectApply,
  basePrefix,
  actionData,
}: PersonEditorProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");

  const { form, fields } = useForm(personFormSchema, {
    lastResult: actionData,
    defaultValue: {
      id: person?.id ?? "",
      firstName: person?.firstName ?? "",
      lastName: person?.lastName ?? "",
      honorific: person?.honorific ?? "",
      email: person?.email ?? "",
      phone: person?.phone ?? "",
      bio: person?.bio ?? "",
      photoUrl: person?.photoUrl ?? "",
      memberStateId: person?.memberStateId ?? "",
      languages: person?.languages ?? [],
      showEmail: person?.showEmail ?? false,
      showPhone: person?.showPhone ?? false,
    },
  });

  const cancelHref = person ? `${basePrefix}/${person.id}` : basePrefix;
  const submitLabel = canDirectApply
    ? t("actions.submitAndApprove")
    : person
      ? t("actions.submitAndEdit")
      : t("actions.submit");

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {person?.id ? (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("people.cards.basics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr_2fr]">
            <FieldRow
              id={fields.honorific.id}
              label={t("people.fields.honorific")}
              errors={fields.honorific.errors}
            >
              <Input
                {...getInputProps(fields.honorific, { type: "text" })}
                key={fields.honorific.key}
                placeholder={t("people.fields.honorificPlaceholder")}
              />
            </FieldRow>
            <FieldRow
              id={fields.firstName.id}
              label={t("people.fields.firstName")}
              required
              errors={fields.firstName.errors}
            >
              <Input
                {...getInputProps(fields.firstName, { type: "text" })}
                key={fields.firstName.key}
              />
            </FieldRow>
            <FieldRow
              id={fields.lastName.id}
              label={t("people.fields.lastName")}
              required
              errors={fields.lastName.errors}
            >
              <Input
                {...getInputProps(fields.lastName, { type: "text" })}
                key={fields.lastName.key}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.memberStateId.id}
              label={t("people.fields.memberState")}
              errors={fields.memberStateId.errors}
            >
              <SelectField
                meta={fields.memberStateId}
                options={memberStates.map((m) => ({
                  value: m.id,
                  label: `${m.fullName} (${m.abbreviation})`,
                }))}
                placeholder={t("people.fields.memberStatePlaceholder")}
              />
            </FieldRow>
            <FieldRow
              id={fields.photoUrl.id}
              label={t("people.fields.photoUrl")}
              errors={fields.photoUrl.errors}
            >
              <Input
                {...getInputProps(fields.photoUrl, { type: "url" })}
                key={fields.photoUrl.key}
                placeholder="https://"
              />
            </FieldRow>
          </div>

          <FieldRow id={fields.bio.id} label={t("people.fields.bio")} errors={fields.bio.errors}>
            <Textarea {...getTextareaProps(fields.bio)} key={fields.bio.key} rows={4} />
          </FieldRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("people.cards.contact")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldRow
              id={fields.email.id}
              label={t("people.fields.email")}
              errors={fields.email.errors}
            >
              <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
            </FieldRow>
            <FieldRow
              id={fields.phone.id}
              label={t("people.fields.phone")}
              errors={fields.phone.errors}
            >
              <Input {...getInputProps(fields.phone, { type: "tel" })} key={fields.phone.key} />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-center gap-3">
              <SwitchField meta={fields.showEmail} />
              <Label htmlFor={fields.showEmail.id}>{t("people.fields.showEmail")}</Label>
            </div>
            <div className="flex items-center gap-3">
              <SwitchField meta={fields.showPhone} />
              <Label htmlFor={fields.showPhone.id}>{t("people.fields.showPhone")}</Label>
            </div>
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
