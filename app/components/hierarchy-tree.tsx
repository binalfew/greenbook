import {
  useRef,
  useMemo,
  useCallback,
  useState,
  useEffect,
  useReducer,
  createContext,
  useContext,
} from "react";
import type { Fetcher } from "react-router";
import type { ReactElement } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { Tree } from "react-arborist";
import type { TreeApi, CursorProps, MoveHandler, NodeRendererProps } from "react-arborist";
import useResizeObserver from "use-resize-observer";
import {
  ChevronRight,
  Search,
  X,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/utils/misc";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

// Generic virtualized hierarchy tree.
//
// Features:
// - Lazy-loaded children via a fetcher posting { intent: "loadChildren", parentId }
//   to the parent route; the result must be { children: RawChild[] }.
// - Debounced client-side search via the ?q= query param.
// - Optional drag-and-drop reparenting, gated by `moveIdField` + `moveParentField`
//   + `readOnly={false}`. Moves submit to the parent route and ship an Undo toast.
// - Pluggable node renderer + search-match + breadcrumb formatter.
//
// Consumers provide:
// - rawData: root nodes only
// - transformNodes(rawData, lazyCache, baseUrl): typed tree nodes
// - nodeRenderer: per-node JSX
// - searchMatch(node, lower): filter predicate

/* ── Constants ────────────────────────────────────────────── */

const INDENT = 24;
const ROW_HEIGHT = 44;
const SEARCH_DEBOUNCE_MS = 200;

/** Shared empty array for leaf nodes — avoids allocation per node. Cast freely; always empty. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EMPTY_CHILDREN: any[] = [];

/* ── Base node interface ──────────────────────────────────── */

export interface HierarchyNode {
  id: string;
  rawId: string;
  name: string;
  childCount?: number;
  children?: HierarchyNode[];
  isPlaceholder?: boolean;
}

/* ── Context for tree actions ─────────────────────────────── */

export interface TreeActionsContextValue {
  /** Manager-only: move a node back to root. Node renderers call this from their context menu. */
  moveToRoot: (nodeId: string, nodeName: string) => void;
  /** True when the tree is read-only (public tier, or user lacks write permission). */
  readOnly: boolean;
  /** Base URL for detail/edit/delete links inside node renderers. */
  baseUrl: string;
}

export const TreeActionsContext = createContext<TreeActionsContextValue>({
  moveToRoot: () => {},
  readOnly: true,
  baseUrl: "",
});

export function useTreeActions() {
  return useContext(TreeActionsContext);
}

// Surface `{ ok: false, error }` action responses as error toasts. Fires once
// per idle transition. Consumers use it for every write fetcher whose action
// returns a structured error envelope.
function useFetcherErrorToast(fetcher: Fetcher) {
  const data = fetcher.data as { ok?: boolean; error?: string } | undefined;
  useEffect(() => {
    if (fetcher.state === "idle" && data?.ok === false && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.state, data]);
}

/* ── Shared context menu styles ───────────────────────────── */

export const menuItemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

export const menuContentClass =
  "z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

/* ── Generic helpers ──────────────────────────────────────── */

function FillFlexParent({
  children,
}: {
  children: (dimens: { width: number; height: number }) => ReactElement;
}) {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} style={{ flex: 1, width: "100%", height: "100%", minHeight: 0, minWidth: 0 }}>
      {width && height ? children({ width, height }) : null}
    </div>
  );
}

function DropCursor({ top, left }: CursorProps) {
  return (
    <div
      className="bg-primary pointer-events-none absolute right-0 z-20 h-0.5 rounded-full"
      style={{ top, left }}
    />
  );
}

export function countDescendants(node: HierarchyNode): number {
  if (!node.children) return node.childCount ?? 0;
  return node.children
    .filter((c) => !c.isPlaceholder)
    .reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

function countNodes(nodes: HierarchyNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + (n.children ? countNodes(n.children) : 0), 0);
}

function filterTree<T extends HierarchyNode>(
  nodes: T[],
  term: string,
  matchFn: (node: T, lower: string) => boolean,
): T[] {
  if (!term) return nodes;
  const lower = term.toLowerCase();
  const result: T[] = [];
  for (const node of nodes) {
    if (node.isPlaceholder) continue;
    if (matchFn(node, lower)) {
      result.push(node);
    } else if (node.children) {
      const filtered = filterTree(node.children as T[], term, matchFn);
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered });
      }
    }
  }
  return result;
}

function findParentRawId(nodes: HierarchyNode[], targetRawId: string): string | null {
  for (const node of nodes) {
    if (node.children) {
      for (const child of node.children) {
        if (child.rawId === targetRawId) return node.rawId;
      }
      const found = findParentRawId(node.children, targetRawId);
      if (found) return found;
    }
  }
  return null;
}

/* ── Shared node row utilities ─────────────────────────────── */

export function PlaceholderRow({ style }: { style: React.CSSProperties }) {
  return (
    <div
      style={style}
      className="text-muted-foreground animate-in fade-in-50 flex items-center gap-2 pl-8 text-sm duration-200"
    >
      <div className="border-muted-foreground/30 border-t-primary size-3.5 animate-spin rounded-full border-2" />
      Loading children...
    </div>
  );
}

/** Renders vertical indentation guide lines for tree depth */
export function IndentGuides<T extends HierarchyNode>({
  node,
}: {
  node: NodeRendererProps<T>["node"];
}) {
  const level = node.level;
  if (level === 0) return null;

  return (
    <>
      {Array.from({ length: level }, (_, i) => (
        <span
          key={i}
          className="bg-border/50 absolute top-0 bottom-0 w-px"
          style={{ left: INDENT * (i + 1) + 4 }}
        />
      ))}
      <span
        className="bg-border/50 absolute h-px"
        style={{
          left: INDENT * level + 4,
          top: ROW_HEIGHT / 2,
          width: INDENT / 2,
        }}
      />
    </>
  );
}

/** Outer row class — no background, just layout */
export function nodeRowClassName<T extends HierarchyNode>(node: NodeRendererProps<T>["node"]) {
  return cn(
    "group/row relative flex items-center gap-1.5 pr-3 cursor-pointer",
    "animate-in fade-in-50 slide-in-from-left-1 duration-200",
    node.isDragging && "opacity-40",
  );
}

/** Inner content wrapper — carries the background highlight starting from the node content */
export function nodeContentClassName<T extends HierarchyNode>(node: NodeRendererProps<T>["node"]) {
  return cn(
    "flex items-center gap-1.5 flex-1 min-w-0 rounded-md px-1.5 py-0.5 mx-0.5 transition-all duration-150",
    node.isSelected && "bg-primary/10 dark:bg-primary/20",
    node.willReceiveDrop && "bg-primary/15 dark:bg-primary/25 ring-1 ring-primary/40",
    node.isFocused && !node.isSelected && "bg-accent/50",
    !node.isSelected && !node.isFocused && !node.willReceiveDrop && "hover:bg-muted/60",
  );
}

export function DragHandle<T extends HierarchyNode>({
  dragHandle,
  hasChildren,
}: {
  dragHandle: NodeRendererProps<T>["dragHandle"];
  hasChildren: boolean;
}) {
  return (
    <div
      ref={dragHandle}
      className={cn(
        "relative z-10 flex shrink-0 cursor-grab items-center justify-center opacity-0 group-hover/row:opacity-60 hover:!opacity-100 active:cursor-grabbing",
        hasChildren ? "-mr-2.5 size-5" : "size-6",
      )}
    >
      <GripVertical className="text-muted-foreground size-3.5" />
    </div>
  );
}

export function ExpandToggle<T extends HierarchyNode>({
  node,
}: {
  node: NodeRendererProps<T>["node"];
}) {
  return (
    <button
      type="button"
      className="hover:bg-muted/80 relative z-10 flex size-6 shrink-0 items-center justify-center rounded transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        node.toggle();
      }}
    >
      <ChevronRight
        className={cn(
          "text-muted-foreground size-3.5 transition-transform duration-200",
          node.isOpen && "rotate-90",
        )}
      />
    </button>
  );
}

/* ── Breadcrumb helper ────────────────────────────────────── */

function buildBreadcrumb<T extends HierarchyNode>(
  nodes: T[],
  targetId: string,
  path: T[] = [],
): T[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [...path, node];
    if (node.children) {
      const found = buildBreadcrumb(node.children as T[], targetId, [...path, node]);
      if (found) return found;
    }
  }
  return null;
}

/* ── Props ────────────────────────────────────────────────── */

export interface HierarchyTreeProps<T extends HierarchyNode> {
  /** Raw data from the loader (roots only) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawData: any[];
  /** Base URL for building node IDs (e.g. "/$tenant/directory/organizations") */
  baseUrl: string;
  /** Transform raw data + lazy cache into typed tree nodes */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformNodes: (rawData: any[], lazyCache: Record<string, any[]>, baseUrl: string) => T[];
  /** Node renderer component */
  nodeRenderer: React.ComponentType<NodeRendererProps<T>>;
  /** Search match function */
  searchMatch: (node: T, lowerTerm: string) => boolean;
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** Empty state when no data */
  emptyState?: React.ReactNode;
  /** Field name for the move submission's ID (e.g. "organizationId"). DnD is gated on this + moveParentField + !readOnly. */
  moveIdField?: string;
  /** Field name for the move submission's parent (e.g. "parentId") */
  moveParentField?: string;
  /** URL for move submissions. Falls back to `baseUrl`. */
  moveUrl?: string;
  /** URL for lazy-load (loadChildren) submissions. Falls back to `baseUrl`. */
  childrenUrl?: string;
  /** Render a breadcrumb segment — if provided, enables the breadcrumb trail */
  renderBreadcrumb?: (node: T, isLast: boolean) => React.ReactNode;
  /** Extra toolbar content rendered before the Collapse All button */
  extraToolbar?: React.ReactNode;
  /** Read-only tree: disables DnD, context-menu write actions, and the grip handle. */
  readOnly?: boolean;
}

/* ── Main component ───────────────────────────────────────── */

export function HierarchyTree<T extends HierarchyNode>({
  rawData,
  baseUrl,
  transformNodes,
  nodeRenderer: NodeRenderer,
  searchMatch,
  searchPlaceholder = "Filter...",
  emptyState,
  moveIdField,
  moveParentField,
  moveUrl,
  childrenUrl,
  renderBreadcrumb,
  extraToolbar,
  readOnly = false,
}: HierarchyTreeProps<T>) {
  const treeRef = useRef<TreeApi<T> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadedChildrenRef = useRef<Record<string, any[]>>({});
  const currentLoadRef = useRef<string | null>(null);
  const pendingLoadsRef = useRef<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const undoFetcher = useFetcher();
  const childFetcher = useFetcher({ key: "child-loader" });

  const search = searchParams.get("q") ?? "";
  const dndEnabled = !readOnly && !!moveIdField && !!moveParentField;
  const resolvedChildrenUrl = childrenUrl ?? baseUrl;
  const resolvedMoveUrl = moveUrl ?? baseUrl;

  // Force a re-render after the lazy cache is mutated in an effect — ref
  // writes don't re-render on their own, and `useMemo` needs to see the new
  // lazyChildren object identity to recompute `allData`.
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);

  // Surface backend move failures (e.g. cycle detected, stale parent). The
  // optimistic cache update is not rolled back — the user sees the error
  // toast and can drag again. Rolling back the cache deterministically
  // requires tracking the (id, prevParent) pair per fetcher submission;
  // deferred until the MOVE path sees enough traffic to warrant it.
  useFetcherErrorToast(fetcher);
  useFetcherErrorToast(undoFetcher);

  // Accumulate completed child fetch into the cache ref, then trigger a
  // re-render so `useMemo(allData, [lazyChildren, ...])` picks up the new
  // object identity. Runs in an effect (not during render) so side effects
  // stay out of React's render cycle.
  useEffect(() => {
    if (childFetcher.state !== "idle" || !currentLoadRef.current) return;
    const result = childFetcher.data as { children?: unknown[] } | undefined;
    if (!result?.children) return;
    const pid = currentLoadRef.current;
    if (!loadedChildrenRef.current[pid]) {
      loadedChildrenRef.current = { ...loadedChildrenRef.current, [pid]: result.children };
      forceRerender();
    }
    currentLoadRef.current = null;
    if (pendingLoadsRef.current.length > 0) {
      queueMicrotask(() => processQueue());
    }
  }, [childFetcher.state, childFetcher.data]);

  const lazyChildren = loadedChildrenRef.current;

  const allData = useMemo(
    () => transformNodes(rawData, lazyChildren, baseUrl),
    [rawData, lazyChildren, baseUrl, transformNodes],
  );

  const data = useMemo(
    () => filterTree(allData, search, searchMatch),
    [allData, search, searchMatch],
  );

  const total = useMemo(() => countNodes(data), [data]);

  const handleSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSearchParams(
          (prev) => {
            if (value) prev.set("q", value);
            else prev.delete("q");
            return prev;
          },
          { replace: true, preventScrollReset: true },
        );
      }, SEARCH_DEBOUNCE_MS);
    },
    [setSearchParams],
  );

  // Clear any pending debounce when the tree unmounts so a late setSearchParams
  // never fires into a dead component.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function processQueue() {
    if (childFetcher.state !== "idle" || currentLoadRef.current) return;
    while (pendingLoadsRef.current.length > 0) {
      const nextId = pendingLoadsRef.current.shift()!;
      if (loadedChildrenRef.current[nextId]) continue;
      currentLoadRef.current = nextId;
      const body = new FormData();
      body.set("intent", "loadChildren");
      body.set("parentId", nextId);
      childFetcher.submit(body, { method: "post", action: resolvedChildrenUrl });
      return;
    }
  }

  function triggerLazyLoad(nodeId: string) {
    const rawId = nodeId.replace(`${baseUrl}/`, "");
    if (
      loadedChildrenRef.current[rawId] ||
      currentLoadRef.current === rawId ||
      pendingLoadsRef.current.includes(rawId)
    )
      return;
    pendingLoadsRef.current.push(rawId);
    processQueue();
  }

  function updateCacheForMove(nodeId: string, oldParentId: string, newParentId: string) {
    const cache = { ...loadedChildrenRef.current };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let movedNode: any | undefined;
    if (oldParentId && cache[oldParentId]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      movedNode = cache[oldParentId].find((c: any) => c.id === nodeId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cache[oldParentId] = cache[oldParentId].filter((c: any) => c.id !== nodeId);
    }
    if (!movedNode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      movedNode = rawData.find((a: any) => a.id === nodeId);
    }

    if (newParentId && movedNode) {
      cache[newParentId] = [...(cache[newParentId] ?? []), movedNode];
    }

    loadedChildrenRef.current = cache;

    if (newParentId) {
      pendingLoadsRef.current = pendingLoadsRef.current.filter((id) => id !== newParentId);
    }
  }

  function submitMove(id: string, parentId: string, fetcherOverride = fetcher) {
    if (!dndEnabled) return;
    const body = new FormData();
    body.set("intent", "move");
    body.set(moveIdField!, id);
    body.set(moveParentField!, parentId);
    fetcherOverride.submit(body, { method: "post", action: resolvedMoveUrl });
  }

  function handleMoveToRoot(nodeId: string, nodeName: string) {
    if (!dndEnabled) return;
    const previousParentId = findParentRawId(allData, nodeId);
    if (previousParentId) updateCacheForMove(nodeId, previousParentId, "");
    submitMove(nodeId, "");
    toast(`Moved "${nodeName}" to root`, {
      action: previousParentId
        ? {
            label: "Undo",
            onClick: () => {
              updateCacheForMove(nodeId, "", previousParentId);
              submitMove(nodeId, previousParentId, undoFetcher);
            },
          }
        : undefined,
    });
  }

  const handleMove: MoveHandler<T> = ({ dragIds, parentId }) => {
    if (!dndEnabled) return;
    for (const dragId of dragIds) {
      const dragNode = treeRef.current?.get(dragId);
      if (!dragNode) continue;

      const nodeId = dragNode.data.rawId;
      const parentNode = parentId ? treeRef.current?.get(parentId) : null;
      const newParentNodeId = parentNode?.data.rawId ?? "";
      const previousParentId = dragNode.parent?.data.rawId ?? "";

      if (newParentNodeId === previousParentId) continue;

      updateCacheForMove(nodeId, previousParentId, newParentNodeId);
      submitMove(nodeId, newParentNodeId);

      const destinationName = parentNode?.data.name ?? "root";
      toast(`Moved "${dragNode.data.name}" → ${destinationName}`, {
        action: {
          label: "Undo",
          onClick: () => {
            updateCacheForMove(nodeId, newParentNodeId, previousParentId);
            submitMove(nodeId, previousParentId, undoFetcher);
          },
        },
      });
    }
  };

  if (rawData.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const isMoving = fetcher.state !== "idle" || undoFetcher.state !== "idle";

  return (
    <TreeActionsContext.Provider value={{ moveToRoot: handleMoveToRoot, readOnly, baseUrl }}>
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <div className="relative w-full sm:min-w-0 sm:flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              ref={searchInputRef}
              defaultValue={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="pr-8 pl-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  if (searchInputRef.current) searchInputRef.current.value = "";
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  setSearchParams(
                    (prev) => {
                      prev.delete("q");
                      return prev;
                    },
                    { replace: true, preventScrollReset: true },
                  );
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              >
                <X className="size-3.5" />
                <span className="sr-only">Clear search</span>
              </button>
            )}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
            {search && (
              <span className="text-muted-foreground text-sm whitespace-nowrap">
                {data.length} result{data.length === 1 ? "" : "s"}
              </span>
            )}
            {dndEnabled && isMoving && (
              <span className="text-primary animate-pulse text-sm whitespace-nowrap">
                Moving...
              </span>
            )}
            {extraToolbar}
            <Button
              variant="outline"
              size="default"
              className="flex-1 sm:flex-initial"
              onClick={() => treeRef.current?.openAll()}
            >
              <ChevronsUpDown />
              Expand All
            </Button>
            <Button
              variant="outline"
              size="default"
              className="flex-1 sm:flex-initial"
              onClick={() => treeRef.current?.closeAll()}
            >
              <ChevronsDownUp />
              Collapse All
            </Button>
          </div>
        </div>

        {/* Breadcrumb trail */}
        {renderBreadcrumb &&
          selectedNodeId &&
          (() => {
            const trail = buildBreadcrumb(allData, selectedNodeId);
            if (!trail || trail.length === 0) return null;
            return (
              <div className="text-muted-foreground bg-muted/30 flex items-center gap-1 overflow-x-auto rounded-md border px-2 py-1.5 text-xs">
                {trail.map((node, i) => (
                  <span key={node.id} className="flex shrink-0 items-center gap-1">
                    {i > 0 && <ChevronRight className="text-muted-foreground/50 size-3" />}
                    {renderBreadcrumb(node, i === trail.length - 1)}
                  </span>
                ))}
              </div>
            );
          })()}

        {/* Tree */}
        <div
          className="bg-card overflow-hidden rounded-lg border"
          style={{ height: Math.min(Math.max(total * ROW_HEIGHT, 300), 600) }}
        >
          <FillFlexParent>
            {({ width, height }) => (
              <Tree<T>
                ref={treeRef}
                data={data}
                width={width}
                height={height}
                openByDefault={false}
                disableEdit
                disableDrag={!dndEnabled}
                disableDrop={!dndEnabled}
                disableMultiSelection
                selectionFollowsFocus
                renderCursor={DropCursor}
                onMove={dndEnabled ? handleMove : undefined}
                rowHeight={ROW_HEIGHT}
                indent={INDENT}
                overscanCount={8}
                padding={6}
                rowClassName="outline-none"
                onActivate={() => {}}
                onSelect={(nodes) => {
                  const first = nodes[0];
                  setSelectedNodeId(first?.id ?? null);
                }}
                onToggle={(id) => {
                  if (id) {
                    const node = treeRef.current?.get(id);
                    if (
                      node?.isOpen &&
                      node.children?.length === 1 &&
                      node.children[0].data.isPlaceholder
                    ) {
                      triggerLazyLoad(id);
                    }
                  }
                }}
              >
                {NodeRenderer}
              </Tree>
            )}
          </FillFlexParent>
        </div>
      </div>
    </TreeActionsContext.Provider>
  );
}
