import { useEffect, useRef, useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import logoUrl from "~/assets/logo.svg";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/utils/misc";

/** Small-caps line used for the imprint and section labels. */
export const AUTH_SMALL_CAPS = "text-xs font-medium tracking-[0.14em] uppercase";

/** Every text input on an auth page: 44px tall, 16px text so iOS does not zoom. */
export const AUTH_INPUT = "h-11 rounded-sm text-base";

/** Every full-width action on an auth page. */
export const AUTH_BUTTON =
  "h-11 w-full rounded-sm text-base font-medium transition-[color,background-color,box-shadow,transform] active:scale-[0.96] motion-reduce:active:scale-100";

/** A text link with a 44px-tall hit area. */
export const AUTH_TEXT_LINK =
  "text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm underline-offset-4 transition-colors hover:underline";

// A hairline, then two sheets peeking out underneath, then the lift off the desk.
const PAGE_STACK =
  "shadow-[0_0_0_1px_rgb(0_0_0/0.08),3px_3px_0_-1px_var(--paper),3px_3px_0_0_rgb(0_0_0/0.08),6px_6px_0_-1px_var(--paper),6px_6px_0_0_rgb(0_0_0/0.08),0_24px_48px_-16px_rgb(0_0_0/0.25)]";

const GUTTER =
  "bg-[linear-gradient(to_right,transparent,rgb(0_0_0/0.07)_48%,rgb(0_0_0/0.12)_50%,rgb(0_0_0/0.07)_52%,transparent)]";

export type AuthBookProps = {
  children: React.ReactNode;
};

/**
 * The frame every `_auth/*` page sits in: the Greenbook lying open on a desk.
 * The left page is the title page and never changes; the route renders on the
 * right page. On narrow screens the two pages stack.
 */
export function AuthBook({ children }: AuthBookProps) {
  const { t } = useTranslation("auth");

  return (
    <div className="bg-muted flex min-h-svh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div
          className={cn(
            "bg-paper relative grid w-full max-w-[62rem] rounded-sm md:min-h-[36rem] md:grid-cols-2",
            PAGE_STACK,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 left-1/2 hidden w-16 -translate-x-1/2 md:block",
              GUTTER,
            )}
          />

          <section className="flex flex-col items-center justify-between gap-8 px-6 pt-10 pb-2 text-center sm:px-12 md:py-14">
            <div className="flex flex-col items-center gap-5 md:my-auto">
              <span className="outline-gilt/60 bg-primary flex size-24 items-center justify-center rounded-full outline outline-offset-[-5px]">
                <img
                  src={logoUrl}
                  alt=""
                  width={77}
                  height={77}
                  className="size-[80%] brightness-0 invert"
                />
              </span>
              <p className="font-serif text-5xl leading-none tracking-tight lg:text-6xl">
                Greenbook
              </p>
              <span className="bg-gilt h-px w-16" />
              <p className="text-muted-foreground max-w-[26ch] font-serif text-base text-pretty italic">
                {t("brandSubtitle")}
              </p>
            </div>
            <p
              className={cn(AUTH_SMALL_CAPS, "text-muted-foreground hidden tabular-nums md:block")}
            >
              {t("brandImprint", { year: new Date().getFullYear() })}
            </p>
          </section>

          <section className="flex flex-col justify-center gap-6 px-6 py-10 sm:px-12 md:py-14">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}

/** The heading block at the top of the right page. */
export function AuthHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className={cn(AUTH_SMALL_CAPS, "text-primary")}>{eyebrow}</p>
      <h1 className="font-serif text-3xl leading-tight tracking-tight text-balance">{title}</h1>
      {description ? (
        <p className="text-muted-foreground text-[15px] text-pretty">{description}</p>
      ) : null}
    </div>
  );
}

/** A small-caps label over a group of controls ("With your organization"). */
export function AuthSectionLabel({ children }: { children: React.ReactNode }) {
  return <p className={cn(AUTH_SMALL_CAPS, "text-muted-foreground")}>{children}</p>;
}

/** A message about the whole form (wrong password, failed SSO round trip). */
export function AuthFormError({
  id,
  errors,
}: {
  id?: string;
  errors?: Array<string | null | undefined> | null;
}) {
  const messages = errors?.filter(Boolean);
  if (!messages?.length) return null;
  return (
    <div
      id={id}
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-sm border px-3.5 py-3 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
}

/** A message about one field, rendered directly under it. */
export function AuthFieldError({
  id,
  errors,
}: {
  id?: string;
  errors?: Array<string | null | undefined> | null;
}) {
  const messages = errors?.filter(Boolean);
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-destructive flex items-start gap-1.5 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}

/**
 * Focus a field when it appears — after hydration, so server and client markup
 * agree — and never on touch, where it would throw the keyboard open. Runs
 * again only when `enabled` turns on, so a re-render never steals focus back.
 */
export function useFocusOnMount<T extends HTMLElement = HTMLInputElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled && !("ontouchstart" in window)) ref.current?.focus();
  }, [enabled]);
  return ref;
}

/** A password input with a show/hide button laid over its right edge. */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const { t } = useTranslation("auth");
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn(AUTH_INPUT, "pr-11", className)}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? t("hidePassword") : t("showPassword")}
        aria-pressed={shown}
        className="text-muted-foreground hover:text-foreground absolute top-0 right-0 flex size-11 items-center justify-center rounded-sm transition-colors"
      >
        {shown ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/** The submit button: disabled, with a spinner and its own label, while the form is in flight. */
export function AuthSubmit({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  /** Shown while pending; the idle label stays when omitted. */
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" disabled={pending} className={cn(AUTH_BUTTON, "gap-2")}>
      {pending ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
