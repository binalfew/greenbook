import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

export type CascadeItem = { id: string; name: string; code?: string | null };

type IntentLike = { update: (args: { name: string; value: string }) => void };

/** Accepts any Conform field metadata (stable or future). Only reads
 *  `name` and `initialValue`/`defaultValue` — no dependency on extended getters. */
type CascadeField = {
  name: string;
  initialValue?: unknown;
  defaultValue?: string;
};

const IS_DEV = process.env.NODE_ENV !== "production";

const toOption = (i: CascadeItem) => ({
  value: i.id,
  label: i.code ? `${i.name} (${i.code})` : i.name,
});

/** A readable node in a cascade tree. Passed as `parent` when declaring a
 *  child level. */
export type CascadeNode = {
  getValue: () => string;
  subscribe: (cb: (value: string) => void) => () => void;
  /** @internal — shared tree-wide registry used for dev-time invariants.
   *  Not for consumer use. */
  __tree: CascadeTreeRegistry;
};

export type CascadeBinding = CascadeNode & {
  /** Bumps whenever this level is cleared — pass to `<SelectField key>`.
   *  Empty string for root levels (no remount needed). */
  key: string;
  /** Current value of this level's parent. Empty string for roots or when
   *  a child's parent is unset. */
  parentValue: string;
  /** Derived from this level's fetcher. Empty for roots or when parent is unset. */
  options: Array<{ value: string; label: string }>;
  /** Reflects parentUnset / loading / ready states. Empty for roots. */
  placeholder: string;
  isLoading: boolean;
  /** Wire to `<SelectField onValueChange>`. */
  onValueChange: (value: string) => void;
  /** Refetch this level's data using the current parent value. No-op for roots. */
  reload: () => void;
};

// ── internals ─────────────────────────────────────────────────────────────

type Publisher = {
  get: () => string;
  set: (v: string) => void;
  subscribe: (cb: (v: string) => void) => () => void;
  /** Number of active subscribers. Used for the orphan-root dev warning. */
  subscriberCount: () => number;
};

export function createPublisher(initial: string): Publisher {
  let value = initial;
  const subs = new Set<(v: string) => void>();
  return {
    get: () => value,
    set: (v) => {
      if (value === v) return;
      value = v;
      for (const cb of subs) cb(v);
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    subscriberCount: () => subs.size,
  };
}

type CascadeTreeRegistry = {
  registerField: (name: string) => void;
};

function createTreeRegistry(): CascadeTreeRegistry {
  const fieldNames = new Set<string>();
  return {
    registerField: (name) => {
      if (!IS_DEV) return;
      if (fieldNames.has(name)) {
        throw new Error(
          `useCascade: duplicate field name "${name}" in the same cascade tree. ` +
            `Each level must bind to a distinct Conform field.`,
        );
      }
      fieldNames.add(name);
    },
  };
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Config for a single cascade level.
 *
 * - Root: omit `parent`. No child-only fields are needed or accepted.
 * - Child: provide `parent` plus `buildUrl`, `intent`, and placeholders.
 *
 * The discriminated union ensures you cannot forget the child-only fields
 * when specifying a parent, nor pass them on a root.
 */
export type UseCascadeConfig =
  | { field: CascadeField; parent?: never }
  | {
      field: CascadeField;
      parent: CascadeNode;
      buildUrl: (parentValue: string) => string;
      intent: IntentLike;
      /** Shown when the parent is unset or the list is ready. Defaults to `"Select"`.
       *  The field's own label supplies the noun, so the placeholder needs no context. */
      placeholder?: string;
      /** Shown while fetching. Defaults to `"Loading..."`. */
      loadingPlaceholder?: string;
    };

/**
 * Declares one level of a cascade chain or tree. Omit `parent` for the root;
 * pass another level's returned binding as `parent` for each dependent level.
 *
 * The returned `CascadeBinding` is shape-uniform across root and child — pass
 * any binding as `parent` to the next level without type gymnastics.
 */
export function useCascade(config: UseCascadeConfig): CascadeBinding {
  const parent = config.parent;

  // Per-level publisher (holds this level's current value + subscribers).
  const pubRef = useRef<Publisher | null>(null);
  if (pubRef.current === null) {
    pubRef.current = createPublisher(config.field.defaultValue ?? "");
  }
  const pub = pubRef.current;

  // Tree registry: root creates a new one, children inherit from parent.
  const treeRef = useRef<CascadeTreeRegistry | null>(null);
  if (treeRef.current === null) {
    treeRef.current = parent ? parent.__tree : createTreeRegistry();
    treeRef.current.registerField(config.field.name);
  }
  const tree = treeRef.current;

  const keyRef = useRef(0);
  // Always allocated so hook count is stable — roots simply never call .load.
  const fetcher = useFetcher<{ items: CascadeItem[] }>();

  // Refs that the mount-only subscriber callback reads at fire time, so it
  // always sees the latest closure values instead of first-render captures.
  const buildUrlRef = useRef<((v: string) => string) | null>(null);
  const intentRef = useRef<IntentLike | null>(null);
  const fieldNameRef = useRef(config.field.name);
  const fetcherLoadRef = useRef(fetcher.load);
  fieldNameRef.current = config.field.name;
  fetcherLoadRef.current = fetcher.load;
  if (config.parent) {
    buildUrlRef.current = config.buildUrl;
    intentRef.current = config.intent;
  }

  // Capture parent once; the useEffect below runs mount-only and closes over
  // this ref to avoid re-subscribing on every render.
  const parentRef = useRef<CascadeNode | null>(parent ?? null);

  useEffect(() => {
    const p = parentRef.current;
    if (!p) return; // roots don't subscribe

    const initialParent = p.getValue();
    if (initialParent && buildUrlRef.current) {
      fetcherLoadRef.current(buildUrlRef.current(initialParent));
    }

    return p.subscribe((newParentValue) => {
      if (pub.get()) {
        keyRef.current++;
        intentRef.current?.update({ name: fieldNameRef.current, value: "" });
        pub.set("");
      }
      if (newParentValue && buildUrlRef.current) {
        fetcherLoadRef.current(buildUrlRef.current(newParentValue));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orphan-root dev warning: if a root's value changes but nothing subscribed,
  // the consumer probably forgot to wire a child to it.
  const warnedRef = useRef(false);
  const rootOnValueChange = (value: string) => {
    if (IS_DEV && !warnedRef.current && pub.subscriberCount() === 0 && value !== pub.get()) {
      warnedRef.current = true;
      // eslint-disable-next-line no-console
      console.warn(
        `useCascade(${config.field.name}): value changed but no children are subscribed. ` +
          `Did you forget to pass this binding as 'parent' to another useCascade call?`,
      );
    }
    pub.set(value);
  };

  // Derived values for the returned binding.
  const isRoot = !parent;
  const parentValue = parent ? parent.getValue() : "";
  const hasParent = isRoot || parentValue !== "";
  const isLoading = !isRoot && fetcher.state === "loading";
  const options = !isRoot && hasParent ? (fetcher.data?.items ?? []).map(toOption) : [];

  let placeholder = "";
  if (!isRoot && config.parent) {
    const base = config.placeholder ?? "Select";
    placeholder = isLoading ? (config.loadingPlaceholder ?? "Loading...") : base;
  }

  return {
    key: isRoot ? "" : `${config.field.name}-${keyRef.current}`,
    parentValue,
    getValue: pub.get,
    subscribe: pub.subscribe,
    onValueChange: isRoot ? rootOnValueChange : pub.set,
    __tree: tree,
    options,
    placeholder,
    isLoading,
    reload: isRoot
      ? () => {}
      : () => {
          if (buildUrlRef.current && parent) {
            fetcherLoadRef.current(buildUrlRef.current(parent.getValue()));
          }
        },
  };
}
