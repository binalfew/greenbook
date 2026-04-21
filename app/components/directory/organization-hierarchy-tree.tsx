import { useNavigate } from "react-router";
import type { NodeRendererProps } from "react-arborist";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Building2, Eye, Pencil, Trash2, ExternalLink, Network, CornerUpLeft } from "lucide-react";
import { cn } from "~/utils/misc";
import {
  HierarchyTree,
  EMPTY_CHILDREN,
  PlaceholderRow,
  nodeRowClassName,
  nodeContentClassName,
  ExpandToggle,
  IndentGuides,
  DragHandle,
  countDescendants,
  menuItemClass,
  menuContentClass,
  useTreeActions,
} from "~/components/hierarchy-tree";
import type { HierarchyNode, HierarchyTreeProps } from "~/components/hierarchy-tree";

// Consumer wrapper around the generic HierarchyTree for Organizations.
//
// Raw shape is whatever the loader returns from `listRootOrganizations` or
// the lazy-load resource route — both return rows with the same include
// shape (id, name, acronym, parentId, type, _count.children).

/* ── Node shape ───────────────────────────────────────────── */

interface OrgNode extends HierarchyNode {
  acronym: string | null;
  typeCode: string;
  typeName: string;
  typeLevel: number;
  childCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawOrg = any;

/* ── Helpers ──────────────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  ROOT: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  MAIN_ORGAN:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  DEPARTMENT:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  OFFICE:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  UNIT: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700",
};

const DEFAULT_TYPE_COLOR =
  "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700";

function typeColor(code: string): string {
  return TYPE_COLORS[code] ?? DEFAULT_TYPE_COLOR;
}

function orgSearchMatch(node: OrgNode, lower: string): boolean {
  return (
    node.name.toLowerCase().includes(lower) ||
    (node.acronym?.toLowerCase().includes(lower) ?? false) ||
    node.typeCode.toLowerCase().includes(lower) ||
    node.typeName.toLowerCase().includes(lower)
  );
}

function detailRoute(rawId: string, baseUrl: string): string {
  return `${baseUrl}/${rawId}`;
}

/* ── Transform raw data → tree nodes ──────────────────────── */

function transformOrgNodes(
  rawData: RawOrg[],
  lazyCache: Record<string, RawOrg[]>,
  baseUrl: string,
): OrgNode[] {
  return rawData.map((n) => {
    const childCount = n._count?.children ?? 0;
    const hasLazyChildren = (lazyCache[n.id]?.length ?? 0) > 0;
    const needsLazyLoad = !hasLazyChildren && childCount > 0;

    let children: OrgNode[];
    if (hasLazyChildren) {
      children = transformOrgNodes(lazyCache[n.id]!, lazyCache, baseUrl);
    } else if (needsLazyLoad) {
      children = [
        {
          id: `${baseUrl}/${n.id}/__placeholder`,
          rawId: "__placeholder",
          name: "Loading...",
          acronym: null,
          typeCode: "",
          typeName: "",
          typeLevel: 0,
          childCount: 0,
          isPlaceholder: true,
        },
      ];
    } else {
      children = EMPTY_CHILDREN;
    }

    return {
      id: `${baseUrl}/${n.id}`,
      rawId: n.id,
      name: n.name,
      acronym: n.acronym ?? null,
      typeCode: n.type?.code ?? "",
      typeName: n.type?.name ?? "",
      typeLevel: n.type?.level ?? 0,
      childCount,
      children,
    };
  });
}

/* ── Node renderer ────────────────────────────────────────── */

function OrgNodeRenderer({ node, dragHandle, style }: NodeRendererProps<OrgNode>) {
  const navigate = useNavigate();
  const { moveToRoot, readOnly, baseUrl, placeholderLabel } = useTreeActions();
  const hasChildren = (node.children?.length ?? 0) > 0;
  const descendantCount = countDescendants(node.data);

  if (node.data.isPlaceholder) {
    return <PlaceholderRow style={style} label={placeholderLabel} />;
  }

  const content = (
    <div
      style={style}
      className={nodeRowClassName(node)}
      onClick={() => {
        if (hasChildren) node.toggle();
        node.select();
      }}
    >
      <IndentGuides node={node} />

      {!readOnly && <DragHandle dragHandle={dragHandle} hasChildren={hasChildren} />}

      {hasChildren ? <ExpandToggle node={node} /> : <span className="size-6 shrink-0" />}

      <div className={nodeContentClassName(node)}>
        <div className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-md">
          <Building2 className="size-3.5" />
        </div>

        <div className="relative z-10 ml-1 flex min-w-0 flex-col leading-tight">
          <span
            className={cn(
              "truncate text-sm font-medium",
              node.isSelected ? "text-primary" : "text-foreground",
            )}
          >
            {node.data.name}
          </span>
          {node.data.acronym && (
            <span className="text-muted-foreground mt-0.5 truncate text-[11px] leading-none">
              {node.data.acronym}
            </span>
          )}
        </div>

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {hasChildren && !node.isOpen && descendantCount > 0 && (
            <span className="bg-muted text-muted-foreground inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium tabular-nums">
              {descendantCount}
            </span>
          )}

          {node.data.typeCode && (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide uppercase",
                typeColor(node.data.typeCode),
              )}
            >
              {node.data.typeName.replace(/_/g, " ")}
            </span>
          )}

          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md transition-all sm:opacity-0 sm:group-hover/row:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              navigate(detailRoute(node.data.rawId, baseUrl));
            }}
            title="Open organization details"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  if (readOnly) return content;

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{content}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className={menuContentClass}>
          <ContextMenuPrimitive.Item
            className={menuItemClass}
            onSelect={() => navigate(detailRoute(node.data.rawId, baseUrl))}
          >
            <Eye className="size-4" />
            View Details
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className={menuItemClass}
            onSelect={() => navigate(`${detailRoute(node.data.rawId, baseUrl)}/edit`)}
          >
            <Pencil className="size-4" />
            Edit
          </ContextMenuPrimitive.Item>
          {node.level > 0 && (
            <ContextMenuPrimitive.Item
              className={menuItemClass}
              onSelect={() => moveToRoot(node.data.rawId, node.data.name)}
            >
              <CornerUpLeft className="size-4" />
              Move to root
            </ContextMenuPrimitive.Item>
          )}
          <ContextMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
          <ContextMenuPrimitive.Item
            className={cn(menuItemClass, "text-destructive data-[highlighted]:text-destructive")}
            onSelect={() => navigate(`${detailRoute(node.data.rawId, baseUrl)}/delete`)}
          >
            <Trash2 className="size-4" />
            Delete
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

/* ── Empty state ──────────────────────────────────────────── */

function OrgEmptyState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted flex size-16 items-center justify-center rounded-full">
        <Network className="text-muted-foreground size-8" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">No organizations yet</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {message ??
          "Organizations will appear here as a hierarchy. Create a root organization to start."}
      </p>
    </div>
  );
}

/* ── Public component ─────────────────────────────────────── */

export function OrganizationHierarchyTree({
  roots,
  baseUrl,
  childrenUrl,
  moveUrl,
  canMove,
  searchPlaceholder,
  emptyMessage,
  labels,
}: {
  roots: RawOrg[];
  baseUrl: string;
  /** Resource route URL for lazy-loading children (POST intent=loadChildren). */
  childrenUrl: string;
  /** Resource route URL for manager-only DnD moves (POST intent=move). */
  moveUrl: string;
  /** True when the current user is a manager (enables DnD). */
  canMove: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** i18n'd toolbar + status labels passed through to HierarchyTree. */
  labels?: HierarchyTreeProps<OrgNode>["labels"];
}) {
  return (
    <HierarchyTree<OrgNode>
      rawData={roots}
      baseUrl={baseUrl}
      childrenUrl={childrenUrl}
      moveUrl={moveUrl}
      transformNodes={transformOrgNodes}
      nodeRenderer={OrgNodeRenderer}
      searchMatch={orgSearchMatch}
      searchPlaceholder={searchPlaceholder ?? "Filter organizations..."}
      emptyState={<OrgEmptyState message={emptyMessage} />}
      moveIdField={canMove ? "organizationId" : undefined}
      moveParentField={canMove ? "parentId" : undefined}
      readOnly={!canMove}
      labels={labels}
      renderBreadcrumb={(node, isLast) => (
        <span
          className={cn(
            "flex items-center gap-1",
            isLast ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          <Building2 className="size-3" />
          <span className="max-w-[120px] truncate">{node.name}</span>
        </span>
      )}
    />
  );
}
