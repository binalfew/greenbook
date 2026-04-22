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
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { memberStateFormSchema } from "./member-state-schema";

type MemberStateLike = {
  id: string;
  fullName: string;
  abbreviation: string;
  dateJoined: Date;
  isActive: boolean;
  predecessorOrg: string | null;
  notes: string | null;
  regions: Array<{ regionalGroupId: string }>;
};

export interface MemberStateEditorProps {
  memberState?: MemberStateLike;
  regionalGroups: Array<{ id: string; name: string; code: string }>;
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

const PREDECESSOR_OPTIONS = [
  { value: "", label: "—" },
  { value: "OAU", label: "OAU" },
  { value: "AU", label: "AU" },
];

export function MemberStateEditor({
  memberState,
  regionalGroups,
  actionData,
  basePrefix,
}: MemberStateEditorProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");

  const defaultRegionIds = memberState?.regions.map((r) => r.regionalGroupId) ?? [];

  const { form, fields } = useForm(memberStateFormSchema, {
    id: "member-state-editor",
    lastResult: actionData,
    defaultValue: memberState
      ? {
          id: memberState.id,
          fullName: memberState.fullName,
          abbreviation: memberState.abbreviation,
          dateJoined: new Date(memberState.dateJoined).toISOString().slice(0, 10),
          isActive: memberState.isActive,
          predecessorOrg: memberState.predecessorOrg ?? "",
          notes: memberState.notes ?? "",
        }
      : {
          id: "",
          fullName: "",
          abbreviation: "",
          dateJoined: "",
          isActive: true,
          predecessorOrg: "",
          notes: "",
        },
  });

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {memberState && (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("memberStates")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FieldRow
              id={fields.fullName.id}
              label={t("fullName")}
              required
              errors={fields.fullName.errors}
            >
              <Input
                {...getInputProps(fields.fullName, { type: "text" })}
                key={fields.fullName.key}
                placeholder="Federal Democratic Republic of Ethiopia"
              />
            </FieldRow>
            <FieldRow
              id={fields.abbreviation.id}
              label={t("abbreviation")}
              required
              errors={fields.abbreviation.errors}
            >
              <Input
                {...getInputProps(fields.abbreviation, { type: "text" })}
                key={fields.abbreviation.key}
                maxLength={20}
                placeholder="ETH"
                className="uppercase"
              />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow
              id={fields.dateJoined.id}
              label={t("dateJoined")}
              required
              errors={fields.dateJoined.errors}
            >
              <Input
                {...getInputProps(fields.dateJoined, { type: "date" })}
                key={fields.dateJoined.key}
              />
            </FieldRow>
            <FieldRow
              id={fields.predecessorOrg.id}
              label={t("predecessorOrg")}
              errors={fields.predecessorOrg.errors}
            >
              <SelectField
                meta={fields.predecessorOrg}
                options={PREDECESSOR_OPTIONS}
                placeholder={t("predecessorOrgPlaceholder")}
              />
            </FieldRow>
          </div>
          <div className="flex items-center gap-3">
            <SwitchField meta={fields.isActive} />
            <Label htmlFor={fields.isActive.id}>{t("isActive")}</Label>
          </div>
          <FieldRow id={fields.notes.id} label={t("notes")} errors={fields.notes.errors}>
            <Textarea {...getTextareaProps(fields.notes)} key={fields.notes.key} rows={3} />
          </FieldRow>
        </CardContent>
      </Card>

      {regionalGroups.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{t("regions")}</CardTitle>
            <p className="text-muted-foreground text-xs">{t("regionsHelp")}</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {regionalGroups.map((region) => {
                const checked = defaultRegionIds.includes(region.id);
                return (
                  <label
                    key={region.id}
                    className="hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <Checkbox name="regionIds" value={region.id} defaultChecked={checked} />
                    <div className="min-w-0">
                      <div className="text-foreground text-sm font-medium">{region.name}</div>
                      <div className="text-muted-foreground font-mono text-xs">{region.code}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
