import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "~/utils/misc";

// Shared horizontal tab-strip rendered with NavLinks. Used by the Directory
// layout + the Changes sub-layout and any future surface that wants a
// secondary nav. Keeps the active-border treatment in one place so the two
// bars don't drift visually.

export type NavTabItem = {
  to: string;
  label: string;
  icon?: LucideIcon;
  end?: boolean;
};

export function NavTabs({ items, className }: { items: NavTabItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav
      className={cn(
        "bg-background -mx-4 flex shrink-0 overflow-x-auto border-b px-4 md:-mx-6 md:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )
              }
            >
              {Icon ? <Icon className="size-4" /> : null}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
