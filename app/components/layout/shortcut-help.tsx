import { useState, useMemo } from "react";
import { Keyboard, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { ShortcutInfo } from "~/utils/use-keyboard-shortcuts";

// ─── Types ───────────────────────────────────────────────

interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutInfo[];
}

// ─── Constants ───────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  global: "Global",
  navigation: "Navigation",
  workflow: "Workflow",
  designer: "Form Designer",
};

const GROUP_ORDER = ["global", "navigation", "workflow", "designer"];

// ─── Component ───────────────────────────────────────────

export function ShortcutHelp({ open, onOpenChange, shortcuts }: ShortcutHelpProps) {
  const [filter, setFilter] = useState("");

  // Filter and group shortcuts
  const grouped = useMemo(() => {
    const term = filter.toLowerCase();
    const filtered = term
      ? shortcuts.filter(
          (s) => s.description.toLowerCase().includes(term) || s.keys.toLowerCase().includes(term),
        )
      : shortcuts;

    const groups: Record<string, ShortcutInfo[]> = {};
    for (const shortcut of filtered) {
      const group = shortcut.group;
      if (!groups[group]) groups[group] = [];
      groups[group].push(shortcut);
    }

    return GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({
      label: GROUP_LABELS[g] ?? g,
      shortcuts: groups[g],
    }));
  }, [shortcuts, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
          <Search className="text-muted-foreground size-4" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search shortcuts..."
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {/* Shortcut list */}
        <div className="max-h-[400px] space-y-4 overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm"
                  >
                    <span>{shortcut.description}</span>
                    <ShortcutKeys keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {grouped.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No shortcuts match &ldquo;{filter}&rdquo;
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Key Display ─────────────────────────────────────────

function ShortcutKeys({ keys }: { keys: string }) {
  // Split on " " to render each key part as a separate kbd
  const parts = keys.split(/(\s+)/);

  return (
    <span className="flex items-center gap-1">
      {parts.map((part, i) => {
        const trimmed = part.trim();
        if (!trimmed) return null;
        if (trimmed === "then") {
          return (
            <span key={i} className="text-muted-foreground text-xs">
              then
            </span>
          );
        }
        return (
          <kbd
            key={i}
            className="bg-muted text-muted-foreground inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1.5 font-mono text-[10px] font-medium"
          >
            {trimmed}
          </kbd>
        );
      })}
    </span>
  );
}
