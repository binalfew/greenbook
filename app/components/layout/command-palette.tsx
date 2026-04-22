import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import {
  ArrowRight,
  ClipboardList,
  Clock,
  KeyRound,
  Loader2,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { getVisibleGroups, getVisibleSettingsChildren, type Permission } from "~/config/navigation";

export interface CommandPaletteAction {
  id: string;
  label: string;
  description?: string;
  href: string;
  icon: React.ReactNode;
}

export interface CommandPaletteEntityConfig {
  icon: LucideIcon;
  label: string;
  colorClass?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tenant base path, e.g. `/admin` or `/acme`. Prepended to relative href values. */
  basePrefix?: string;
  /** Quick navigation / create actions shown before a search query is typed. */
  quickActions?: CommandPaletteAction[];
  /** Per-entity-type display config for search results. Forks can extend this. */
  entityConfig?: Record<string, CommandPaletteEntityConfig>;
  /** Label shown in the footer group header for quick actions. */
  quickActionsLabel?: string;
}

interface SearchResultItem {
  id: string;
  category: "action" | "result";
  label: string;
  description?: string;
  href: string;
  icon: React.ReactNode;
  entityType?: string;
}

const RECENT_SEARCHES_KEY = "command-palette-recent";
const MAX_RECENT = 5;

const DEFAULT_ENTITY_CONFIG: Record<string, CommandPaletteEntityConfig> = {
  User: { icon: Users, label: "User", colorClass: "bg-blue-100 text-blue-800" },
  Role: { icon: Shield, label: "Role", colorClass: "bg-purple-100 text-purple-800" },
  Permission: { icon: KeyRound, label: "Permission", colorClass: "bg-amber-100 text-amber-800" },
  AuditLog: { icon: ClipboardList, label: "Log", colorClass: "bg-slate-100 text-slate-800" },
};

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  try {
    const recent = getRecentSearches().filter((s) => s !== query);
    recent.unshift(query);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // localStorage may be unavailable (SSR, private-mode Safari, etc.)
  }
}

function renderEntityIcon(
  type: string,
  config: Record<string, CommandPaletteEntityConfig>,
): React.ReactNode {
  const entry = config[type];
  if (!entry) return <Search className="size-4" />;
  const Icon = entry.icon;
  return <Icon className="size-4" />;
}

/**
 * Default quick-action list derived from the template's navigation config.
 * Returns a flat, permission/feature-filtered list of route jumps + primary
 * create actions. Forks that want to extend the palette should compose this
 * with their own actions (e.g., `[...buildTemplateCommandPaletteActions(...), ...forkActions]`)
 * rather than rewriting the helper.
 */
export function buildTemplateCommandPaletteActions(
  basePrefix: string,
  permissions: Permission[],
  enabledFeatures?: Record<string, boolean>,
): CommandPaletteAction[] {
  const actions: CommandPaletteAction[] = [];

  for (const group of getVisibleGroups(permissions, basePrefix, enabledFeatures)) {
    for (const item of group.items) {
      const Icon = item.icon;
      actions.push({
        id: `nav-${item.url}`,
        label: `Go to ${item.title}`,
        href: item.url,
        icon: <Icon className="size-4" />,
      });
    }
  }

  actions.push({
    id: "nav-settings",
    label: "Go to Settings",
    href: `${basePrefix}/settings`,
    icon: <Settings className="size-4" />,
  });

  for (const child of getVisibleSettingsChildren(permissions, basePrefix, enabledFeatures)) {
    if (child.url === `${basePrefix}/settings`) continue;
    actions.push({
      id: `nav-${child.url}`,
      label: `Go to ${child.title}`,
      description: "Settings",
      href: child.url,
      icon: <Settings className="size-4" />,
    });
  }

  return actions;
}

export function CommandPalette({
  open,
  onOpenChange,
  basePrefix = "/admin",
  quickActions,
  entityConfig,
  quickActionsLabel = "Quick Actions",
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const fetcher = useFetcher();

  const mergedEntityConfig = useMemo(
    () => ({ ...DEFAULT_ENTITY_CONFIG, ...(entityConfig ?? {}) }),
    [entityConfig],
  );

  const resolvedQuickActions: SearchResultItem[] = useMemo(
    () =>
      (quickActions ?? []).map((action) => ({
        id: action.id,
        category: "action" as const,
        label: action.label,
        description: action.description,
        href: action.href,
        icon: action.icon,
      })),
    [quickActions],
  );

  const loading = fetcher.state === "loading";
  const searchData = fetcher.data as
    | {
        results?: {
          results?: Array<{
            id: string;
            type: string;
            title: string;
            subtitle?: string;
            url: string;
          }>;
        };
      }
    | undefined;

  const results: SearchResultItem[] = useMemo(() => {
    const raw = searchData?.results?.results ?? [];
    return raw.map((r) => ({
      id: r.id,
      category: "result" as const,
      label: r.title,
      description: r.subtitle,
      href: `${basePrefix}/${r.url}`,
      icon: renderEntityIcon(r.type, mergedEntityConfig),
      entityType: r.type,
    }));
  }, [searchData, basePrefix, mergedEntityConfig]);

  // Group results by entity type, in the display order of mergedEntityConfig.
  const groupedResults = useMemo(() => {
    const typeOrder = Object.keys(mergedEntityConfig);
    const groups: { type: string; items: SearchResultItem[] }[] = [];
    for (const type of typeOrder) {
      const items = results.filter((r) => r.entityType === type);
      if (items.length > 0) groups.push({ type, items });
    }
    // Append any unknown entity types at the end so forks adding new types
    // still see results even if they forget to register a display config.
    const known = new Set(typeOrder);
    const unknownTypes = new Set(
      results.map((r) => r.entityType).filter((t): t is string => !!t && !known.has(t)),
    );
    for (const type of unknownTypes) {
      groups.push({ type, items: results.filter((r) => r.entityType === type) });
    }
    return groups;
  }, [results, mergedEntityConfig]);

  const flatResults = groupedResults.flatMap((g) => g.items);
  const showResults = query.length >= 2;
  const displayItems = showResults ? flatResults : resolvedQuickActions;

  // Reset dialog state when it opens.
  useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches());
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        fetcher.load(`${basePrefix}/search?q=${encodeURIComponent(value.trim())}`);
      }, 300);
    }
  };

  const selectItem = (item: SearchResultItem) => {
    if (query.trim().length >= 2) {
      addRecentSearch(query.trim());
    }
    onOpenChange(false);
    navigate(item.href);
  };

  const handleRecentClick = (recent: string) => {
    setQuery(recent);
    handleInputChange(recent);
  };

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setSelectedIndex((i) => (i < displayItems.length - 1 ? i + 1 : 0));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setSelectedIndex((i) => (i > 0 ? i - 1 : displayItems.length - 1));
        break;
      }
      case "Enter": {
        e.preventDefault();
        const item = displayItems[selectedIndex];
        if (item) selectItem(item);
        break;
      }
    }
  };

  // Running index for grouped results so keyboard selection highlights the
  // correct item across group boundaries.
  let runningIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>

        <div className="flex items-center border-b px-3">
          <Search className="text-muted-foreground mr-2 size-4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search or jump to..."
            className="placeholder:text-muted-foreground flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none"
          />
          {loading && <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />}
        </div>

        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-2">
          {!showResults && recentSearches.length > 0 && (
            <div className="mb-2">
              <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
                <Clock className="size-3" />
                Recent Searches
              </div>
              {recentSearches.map((recent) => (
                <button
                  key={recent}
                  type="button"
                  onClick={() => handleRecentClick(recent)}
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
                >
                  <Search className="text-muted-foreground size-3" />
                  <span>{recent}</span>
                </button>
              ))}
            </div>
          )}

          {!showResults && resolvedQuickActions.length > 0 && (
            <div>
              <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {quickActionsLabel}
              </div>
              {resolvedQuickActions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  data-result-item
                  onClick={() => selectItem(action)}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                    selectedIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                  }`}
                >
                  <span className="text-muted-foreground">{action.icon}</span>
                  <span className="flex-1 text-left">{action.label}</span>
                  {action.description && (
                    <span className="text-muted-foreground text-xs">{action.description}</span>
                  )}
                  <ArrowRight className="text-muted-foreground size-3" />
                </button>
              ))}
            </div>
          )}

          {showResults &&
            groupedResults.length > 0 &&
            groupedResults.map((group) => {
              const config = mergedEntityConfig[group.type];
              const GroupIcon = config?.icon ?? Search;
              const items = group.items;

              return (
                <div key={group.type} className="mb-1">
                  <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
                    <GroupIcon className="size-3" />
                    {config?.label ?? group.type}s
                    <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                      {items.length}
                    </Badge>
                  </div>
                  {items.map((item) => {
                    const idx = runningIndex++;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-result-item
                        onClick={() => selectItem(item)}
                        className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                          selectedIndex === idx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        <span className="text-muted-foreground">{item.icon}</span>
                        <span className="flex min-w-0 flex-1 text-left">
                          <span className="truncate font-medium">{item.label}</span>
                          {item.description && (
                            <span className="text-muted-foreground ml-2 truncate text-xs">
                              {item.description}
                            </span>
                          )}
                        </span>
                        <Badge className={`shrink-0 text-[10px] ${config?.colorClass ?? ""}`}>
                          {config?.label ?? item.entityType}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              );
            })}

          {showResults && !loading && results.length === 0 && (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
          <div className="flex gap-2">
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
            <span>Open</span>
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
