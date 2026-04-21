import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Checkbox } from "~/components/ui/checkbox";
import { getFormProps, getInputProps, getTextareaProps, useForm } from "~/components/form";
import { getEventsByDomain } from "~/utils/events/webhook-events";
import { webhookFormSchema } from "./webhook-schema";

type WebhookLike = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  headers: unknown;
};

export interface WebhookEditorProps {
  subscription?: WebhookLike;
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

export function WebhookEditor({ subscription, actionData, basePrefix }: WebhookEditorProps) {
  const { t } = useTranslation("webhooks");
  const { t: tc } = useTranslation("common");
  const grouped = getEventsByDomain();

  const { form, fields } = useForm(webhookFormSchema, {
    id: "webhook-editor",
    lastResult: actionData,
    defaultValue: subscription
      ? {
          id: subscription.id,
          url: subscription.url,
          description: subscription.description ?? "",
          events: subscription.events,
          headersJson:
            subscription.headers && typeof subscription.headers === "object"
              ? JSON.stringify(subscription.headers, null, 2)
              : "",
        }
      : {
          id: "",
          url: "",
          description: "",
          events: [] as string[],
          headersJson: "",
        },
  });

  const initialEvents = Array.isArray(fields.events.initialValue)
    ? (fields.events.initialValue as string[])
    : [];

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-6">
      {subscription && (
        <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow id={fields.url.id} label={t("url")} required errors={fields.url.errors}>
            <Input
              {...getInputProps(fields.url, { type: "url" })}
              key={fields.url.key}
              placeholder="https://example.com/webhooks"
            />
          </FieldRow>

          <FieldRow
            id={fields.description.id}
            label={t("description")}
            errors={fields.description.errors}
          >
            <Input
              {...getInputProps(fields.description, { type: "text" })}
              key={fields.description.key}
            />
          </FieldRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("events")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.events.errors && fields.events.errors.length > 0 && (
            <p className="text-destructive text-sm">{fields.events.errors[0]}</p>
          )}
          {Object.entries(grouped).map(([domain, events]) => (
            <div key={domain} className="space-y-2">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {domain}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {events.map((e) => {
                  const id = `event-${e.type}`;
                  const checked = initialEvents.includes(e.type);
                  return (
                    <label
                      key={e.type}
                      htmlFor={id}
                      className="has-[:checked]:bg-muted/60 flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      <Checkbox
                        id={id}
                        name="events"
                        value={e.type}
                        defaultChecked={checked}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-xs">{e.type}</div>
                        <div className="text-muted-foreground text-xs">{e.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("headers")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldRow
            id={fields.headersJson.id}
            label={t("headers")}
            errors={fields.headersJson.errors}
          >
            <Textarea
              {...getTextareaProps(fields.headersJson)}
              key={fields.headersJson.key}
              rows={4}
              placeholder={t("headersPlaceholder")}
              className="font-mono text-xs"
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
