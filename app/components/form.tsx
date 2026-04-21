/**
 * Conform-compatible form utilities and shadcn/Radix field wrappers.
 *
 * Uses the STABLE Conform API:
 * - `useForm` from `@conform-to/react` (wrapped with project defaults)
 * - `getFormProps`, `getInputProps`, `getTextareaProps` re-exported for consumers
 * - Field wrappers use `useControl` for rich components (DatePicker, Select, etc.)
 *
 * Patterns from:
 * - https://github.com/edmundhung/conform/blob/main/examples/shadcn-ui/src/components/form.tsx
 */

import { useRef, useState, useEffect, useCallback, useMemo, type ComponentProps } from "react";
import { useFetcher } from "react-router";
import { ChevronsUpDown, Check, Search, X, Loader2 } from "lucide-react";
import {
  useForm as useFormBase,
  getFormProps,
  getInputProps,
  getTextareaProps,
  getSelectProps,
  unstable_useControl as useControl,
} from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { getZodConstraint } from "@conform-to/zod/v4";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { z } from "zod/v4";

import { cn } from "~/utils/misc";
import { Checkbox } from "~/components/ui/checkbox";
import { Switch } from "~/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import React from "react";

// ═══════════════════════════════════════════════════════════
//  PART 1: Stable useForm wrapper + re-exports
// ═══════════════════════════════════════════════════════════

export { getFormProps, getInputProps, getTextareaProps, getSelectProps };

/**
 * Type guard to distinguish a Conform SubmissionResult (has `status`) from
 * other action responses like `{ success: true }`. Use in multi-intent actions
 * where the fetcher/actionData can be either shape:
 *
 *   lastResult: isSubmissionResult(fetcher.data) ? fetcher.data : undefined
 */
export function isSubmissionResult(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "status" in value;
}

type FormShape<S extends z.ZodType> =
  z.input<S> extends Record<string, any> ? z.input<S> : Record<string, unknown>;

/**
 * Project-standard useForm wrapper using the stable Conform API.
 * Centralizes shouldValidate, shouldRevalidate, and client-side Zod validation.
 *
 * Returns `{ form, fields, intent }` where `intent` is an alias for `form`
 * (stable FormMetadata has .update(), .reset(), .validate() directly).
 */
export function useForm<Schema extends z.ZodType>(
  schema: Schema,
  options: {
    id?: string;
    key?: string;
    lastResult?: unknown;
    defaultValue?: Record<string, unknown>;
  },
) {
  const [form, fields] = useFormBase<FormShape<Schema>>({
    id: options.id,
    lastResult: options.lastResult as never,
    defaultValue: options.defaultValue as never,
    constraint: getZodConstraint(schema),
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
    onValidate({ formData }) {
      return parseWithZod(formData, { schema }) as never;
    },
  });
  return { form, fields, intent: form };
}

// ═══════════════════════════════════════════════════════════
//  PART 2: Field Wrappers — shadcn components with useControl
// ═══════════════════════════════════════════════════════════

/**
 * Minimal field metadata interface accepted by all field wrappers.
 * Compatible with stable FieldMetadata (initialValue may be unknown).
 */
export interface FieldMeta {
  id: string;
  name: string;
  key?: string | null;
  initialValue?: unknown;
  defaultValue?: string;
  descriptionId?: string;
}

/** Safely extract string initialValue from FieldMeta (stable API may give unknown). */
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// ─── CheckboxField ──────────────────────────────────────

export type CheckboxFieldProps = {
  meta: FieldMeta;
} & Omit<
  ComponentProps<typeof Checkbox>,
  "checked" | "onCheckedChange" | "name" | "value" | "defaultChecked"
>;

export function CheckboxField({ meta, ...props }: CheckboxFieldProps) {
  const checkboxRef = useRef<HTMLButtonElement>(null);
  const control = useControl({
    key: meta.key,
    initialValue: str(meta.initialValue) ?? meta.defaultValue,
  });

  return (
    <>
      <input
        type="checkbox"
        ref={control.register}
        name={meta.name}
        value="on"
        defaultChecked={(str(meta.initialValue) ?? meta.defaultValue) === "on"}
        hidden
        tabIndex={-1}
        onFocus={() => checkboxRef.current?.focus()}
      />
      <Checkbox
        {...props}
        ref={checkboxRef}
        id={meta.id}
        checked={control.value === "on"}
        onCheckedChange={(checked) => control.change(checked ? "on" : "")}
        onBlur={() => control.blur()}
      />
    </>
  );
}

// ─── SwitchField ────────────────────────────────────────

export type SwitchFieldProps = {
  meta: FieldMeta;
} & Omit<
  ComponentProps<typeof Switch>,
  "checked" | "onCheckedChange" | "name" | "value" | "defaultChecked"
>;

export function SwitchField({ meta, ...props }: SwitchFieldProps) {
  const switchRef = useRef<HTMLButtonElement>(null);
  const control = useControl({
    key: meta.key,
    initialValue: str(meta.initialValue) ?? meta.defaultValue,
  });

  return (
    <>
      <input
        type="checkbox"
        ref={control.register}
        name={meta.name}
        value="on"
        defaultChecked={(str(meta.initialValue) ?? meta.defaultValue) === "on"}
        hidden
        tabIndex={-1}
        onFocus={() => switchRef.current?.focus()}
      />
      <Switch
        {...props}
        ref={switchRef}
        id={meta.id}
        checked={control.value === "on"}
        onCheckedChange={(checked) => control.change(checked ? "on" : "")}
        onBlur={() => control.blur()}
      />
    </>
  );
}

// ─── RadioGroupField ────────────────────────────────────

export type RadioGroupFieldProps = {
  meta: FieldMeta;
  items: Array<{ value: string; label: string }>;
} & Omit<ComponentProps<typeof RadioGroup>, "value" | "onValueChange" | "name" | "defaultValue">;

export function RadioGroupField({ meta, items, ...props }: RadioGroupFieldProps) {
  const radioGroupRef = useRef<HTMLDivElement>(null);
  const control = useControl({
    key: meta.key,
    initialValue: str(meta.initialValue) ?? meta.defaultValue,
  });

  return (
    <>
      <input
        ref={control.register}
        name={meta.name}
        defaultValue={str(meta.initialValue) ?? meta.defaultValue}
        hidden
        tabIndex={-1}
        onFocus={() => radioGroupRef.current?.focus()}
      />
      <RadioGroup
        {...props}
        ref={radioGroupRef}
        value={control.value ?? ""}
        onValueChange={(value) => control.change(value)}
        onBlur={() => control.blur()}
        aria-labelledby={meta.id}
      >
        {items.map((item) => (
          <div className="flex items-center gap-2" key={item.value}>
            <RadioGroupItem
              id={`${meta.id}-${item.value}`}
              value={item.value}
              aria-describedby={meta.descriptionId}
            />
            <label htmlFor={`${meta.id}-${item.value}`} className="text-sm">
              {item.label}
            </label>
          </div>
        ))}
      </RadioGroup>
    </>
  );
}

// ─── DatePickerField ────────────────────────────────────

export type DatePickerFieldProps = {
  meta: FieldMeta;
  placeholder?: string;
  className?: string;
};

export function DatePickerField({
  meta,
  placeholder = "Pick a date",
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const control = useControl({
    key: meta.key,
    initialValue: str(meta.initialValue) ?? meta.defaultValue,
  });

  const dateValue = control.value ? new Date(control.value) : undefined;
  const isValid = dateValue && !isNaN(dateValue.getTime());

  return (
    <>
      <input
        ref={control.register}
        name={meta.name}
        defaultValue={str(meta.initialValue) ?? meta.defaultValue}
        hidden
        tabIndex={-1}
        onFocus={() => triggerRef.current?.focus()}
      />
      <Popover
        onOpenChange={(open) => {
          if (!open) {
            control.blur();
          }
          setOpen(open);
        }}
        open={open}
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={meta.id}
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !control.value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {isValid ? format(dateValue, "PPP") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={isValid ? dateValue : undefined}
            onSelect={(date) => {
              control.change(date ? format(date, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            defaultMonth={isValid ? dateValue : undefined}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

// ─── SearchableSelectField ──────────────────────────────

type SelectOption = { value: string; label: string; description?: string };

/** @deprecated Use SelectOption instead */
type SearchableSelectOption = SelectOption;

type ClientSideSelectFieldProps = {
  meta: FieldMeta;
  options: SelectOption[];
  fetchUrl?: never;
  formatOption?: never;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  onValueChange?: (value: string) => void;
};

type ServerSideSelectFieldProps = {
  meta: FieldMeta;
  fetchUrl: string;
  formatOption?: (item: SearchResultItem) => SelectOption;
  options?: never;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  onValueChange?: (value: string) => void;
};

/** @deprecated Use ClientSideSelectFieldProps */
type ClientSideSearchableSelectFieldProps = ClientSideSelectFieldProps;
/** @deprecated Use ServerSideSelectFieldProps */
type ServerSideSearchableSelectFieldProps = ServerSideSelectFieldProps;

type ControlledSelectFieldProps = {
  meta?: never;
  fetchUrl?: never;
  formatOption?: never;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  onValueChange?: never;
  name?: string;
};

/** @deprecated Use ControlledSelectFieldProps */
type ControlledSearchableSelectFieldProps = ControlledSelectFieldProps;

export type SelectFieldProps =
  | ClientSideSelectFieldProps
  | ServerSideSelectFieldProps
  | ControlledSelectFieldProps;

/** @deprecated Use SelectFieldProps */
export type SearchableSelectFieldProps = SelectFieldProps;

interface SearchResultItem {
  id: string;
  name: string;
  code?: string;
}

function defaultFormatOption(item: SearchResultItem): SearchableSelectOption {
  return {
    value: item.id,
    label: item.code ? `${item.name} (${item.code})` : item.name,
  };
}

// ─── Shared Popover Base ─────────────────────────────────
// Used by both Conform-managed and controlled variants to avoid duplication.

interface SelectPopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
}

interface SelectPopoverDisplay {
  placeholder: string;
  searchable: boolean;
  searchPlaceholder: string;
  emptyText: string;
  className?: string;
  loading?: boolean;
}

interface SelectPopoverRefs {
  triggerId?: string;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

interface SelectPopoverProps {
  state: SelectPopoverState;
  display: SelectPopoverDisplay;
  refs: SelectPopoverRefs;
  items: SearchableSelectOption[];
  currentValue: string;
  displayLabel: string | null;
  onSelect: (option: SearchableSelectOption) => void;
  onClear: () => void;
  hiddenInput?: React.ReactNode;
  onOpenFocus?: () => void;
  onClose?: () => void;
}

function SelectPopover({
  state: { open, setOpen, query, onQueryChange },
  display: { placeholder, searchable, searchPlaceholder, emptyText, className, loading },
  refs: { triggerId, triggerRef, inputRef },
  items,
  currentValue,
  displayLabel,
  onSelect,
  onClear,
  hiddenInput,
  onOpenFocus,
  onClose,
}: SelectPopoverProps) {
  return (
    <>
      {hiddenInput}
      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (isOpen) {
            onQueryChange("");
            requestAnimationFrame(() => inputRef.current?.focus());
            onOpenFocus?.();
          } else {
            onClose?.();
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={triggerId}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between text-left font-normal",
              !currentValue && "text-muted-foreground",
              className,
            )}
          >
            <span className="truncate">{displayLabel ?? placeholder}</span>
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {currentValue && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      onClear();
                    }
                  }}
                  className="hover:bg-muted rounded-sm p-0.5"
                >
                  <X className="text-muted-foreground size-3" />
                </span>
              )}
              <ChevronsUpDown className="text-muted-foreground size-3.5" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-max max-w-[400px] min-w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          {searchable && (
            <div className="flex items-center border-b px-3 py-2">
              <Search className="text-muted-foreground mr-2 size-4 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
              />
              {loading && <Loader2 className="text-muted-foreground ml-1 size-3.5 animate-spin" />}
              {query && !loading && (
                <button type="button" onClick={() => onQueryChange("")} className="ml-1">
                  <X className="text-muted-foreground size-3.5" />
                </button>
              )}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto p-1">
            {items.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {loading ? "Loading..." : emptyText}
              </p>
            ) : (
              items.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    currentValue === opt.value && "bg-accent",
                  )}
                  onClick={() => onSelect(opt)}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      currentValue === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

// ─── Controlled variant (no Conform) ─────────────────────

function ControlledSelectFieldInner(props: ControlledSelectFieldProps) {
  const {
    options,
    value,
    onChange,
    name,
    placeholder = "Select...",
    searchable,
    searchPlaceholder = "Search...",
    emptyText = "No results found.",
    className,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      q
        ? options.filter(
            (o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q),
          )
        : options,
    [options, q],
  );

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? null,
    [options, value],
  );

  return (
    <SelectPopover
      state={{ open, setOpen, query, onQueryChange: setQuery }}
      display={{
        placeholder,
        searchable: searchable !== false,
        searchPlaceholder,
        emptyText,
        className,
      }}
      refs={{ inputRef }}
      items={filteredItems}
      currentValue={value}
      displayLabel={selectedLabel}
      onSelect={(opt) => {
        onChange(opt.value);
        setOpen(false);
        setQuery("");
      }}
      onClear={() => {
        onChange("");
        setOpen(false);
        setQuery("");
      }}
      hiddenInput={name ? <input type="hidden" name={name} value={value} /> : undefined}
    />
  );
}

// ─── Shared Conform state hook ───────────────────────────

function useConformSelectBase(meta: FieldMeta) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const control = useControl({
    key: meta.key,
    initialValue: str(meta.initialValue) ?? meta.defaultValue,
  });

  const hiddenInput = (
    <input
      ref={control.register}
      name={meta.name}
      defaultValue={str(meta.initialValue) ?? meta.defaultValue}
      hidden
      tabIndex={-1}
      onFocus={() => triggerRef.current?.focus()}
    />
  );

  function makeHandlers(
    onValueChange?: (value: string) => void,
    setLabel?: (label: string | null) => void,
  ) {
    return {
      onSelect: (opt: SearchableSelectOption) => {
        control.change(opt.value);
        setLabel?.(opt.label);
        setOpen(false);
        setQuery("");
        onValueChange?.(opt.value);
      },
      onClear: () => {
        control.change("");
        setLabel?.(null);
        setOpen(false);
        setQuery("");
        onValueChange?.("");
      },
    };
  }

  return {
    triggerRef,
    inputRef,
    open,
    setOpen,
    query,
    setQuery,
    control,
    hiddenInput,
    makeHandlers,
  };
}

// ─── Conform client-side variant (no useFetcher) ─────────

function ClientSideConformSelect({
  meta,
  options,
  placeholder = "Select...",
  searchable,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  onValueChange,
}: ClientSideSelectFieldProps) {
  const {
    triggerRef,
    inputRef,
    open,
    setOpen,
    query,
    setQuery,
    control,
    hiddenInput,
    makeHandlers,
  } = useConformSelectBase(meta);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q),
        )
      : options;
  }, [options, query]);

  // Derive label directly from options — no stale state
  const selectedLabel = useMemo(
    () => options.find((o) => o.value === (control.value ?? ""))?.label ?? null,
    [options, control.value],
  );

  const { onSelect, onClear } = makeHandlers(onValueChange);

  return (
    <SelectPopover
      state={{ open, setOpen, query, onQueryChange: setQuery }}
      display={{
        placeholder,
        searchable: searchable !== false,
        searchPlaceholder,
        emptyText,
        className,
      }}
      refs={{ triggerId: meta.id, triggerRef, inputRef }}
      items={items}
      currentValue={control.value ?? ""}
      displayLabel={selectedLabel}
      onSelect={onSelect}
      onClear={onClear}
      hiddenInput={hiddenInput}
      onClose={() => control.blur()}
    />
  );
}

// ─── Conform server-side variant (with useFetcher) ───────

function ServerSideConformSelect({
  meta,
  fetchUrl,
  formatOption: formatOptionProp,
  placeholder = "Select...",
  searchable,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  onValueChange,
}: ServerSideSelectFieldProps) {
  const formatOption = formatOptionProp ?? defaultFormatOption;
  const {
    triggerRef,
    inputRef,
    open,
    setOpen,
    query,
    setQuery,
    control,
    hiddenInput,
    makeHandlers,
  } = useConformSelectBase(meta);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const searchFetcher = useFetcher<{ items: SearchResultItem[] }>();
  const labelFetcher = useFetcher<{ items: SearchResultItem[] }>();

  const loading = searchFetcher.state === "loading";

  const items: SearchableSelectOption[] = useMemo(
    () => (searchFetcher.data?.items ?? []).map(formatOption),
    [searchFetcher.data, formatOption],
  );

  // Resolve label for initial value from server
  useEffect(() => {
    if (control.value && !selectedLabel) {
      const sep = fetchUrl.includes("?") ? "&" : "?";
      labelFetcher.load(`${fetchUrl}${sep}id=${encodeURIComponent(control.value)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (labelFetcher.data?.items?.length) {
      setSelectedLabel(formatOption(labelFetcher.data.items[0]).label);
    }
  }, [labelFetcher.data, formatOption]);

  useEffect(() => {
    if (!control.value) setSelectedLabel(null);
  }, [control.value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const buildSearchUrl = useCallback(
    (qStr: string) => {
      const separator = fetchUrl.includes("?") ? "&" : "?";
      return `${fetchUrl}${separator}q=${encodeURIComponent(qStr)}`;
    },
    [fetchUrl],
  );

  const { load: searchLoad } = searchFetcher;
  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        searchLoad(buildSearchUrl(newQuery));
      }, 300);
    },
    [buildSearchUrl, searchLoad, setQuery],
  );

  const { onSelect, onClear } = makeHandlers(onValueChange, setSelectedLabel);

  return (
    <SelectPopover
      state={{ open, setOpen, query, onQueryChange: handleQueryChange }}
      display={{
        placeholder,
        searchable: searchable !== false,
        searchPlaceholder,
        emptyText,
        className,
        loading,
      }}
      refs={{ triggerId: meta.id, triggerRef, inputRef }}
      items={items}
      currentValue={control.value ?? ""}
      displayLabel={selectedLabel}
      onSelect={onSelect}
      onClear={onClear}
      hiddenInput={hiddenInput}
      onOpenFocus={() => searchLoad(buildSearchUrl(""))}
      onClose={() => control.blur()}
    />
  );
}

// ─── Public entry point ──────────────────────────────────

export function SelectField(props: SelectFieldProps) {
  if ("value" in props && "onChange" in props) {
    return <ControlledSelectFieldInner {...(props as ControlledSelectFieldProps)} />;
  }
  if ("fetchUrl" in props && props.fetchUrl) {
    return <ServerSideConformSelect {...(props as ServerSideSelectFieldProps)} />;
  }
  return <ClientSideConformSelect {...(props as ClientSideSelectFieldProps)} />;
}

/** @deprecated Use SelectField instead */
export const SearchableSelectField = SelectField;
