import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import type { NavGroup } from "~/config/navigation";

export type ModuleGridProps = {
  /** Visible nav groups (already permission + feature-flag filtered). */
  groups: NavGroup[];
  /**
   * Current pathname, usually `basePrefix`. Items whose `url` matches this
   * are hidden — the "Dashboard" tile pointing back at the page you're
   * already on is just noise.
   */
  hideUrl?: string;
  /** Optional heading above the entire grid. */
  heading?: string;
  /** Optional subtitle below the heading. */
  subtitle?: string;
};

/**
 * Module launchpad rendered on the tenant dashboard. Driven entirely by
 * `navigation.ts` — icon, title, description, and permission/feature
 * gating all come from the nav config. Apps add a new module by adding
 * an entry to navigation.ts; it appears here automatically.
 */
export function ModuleGrid({ groups, hideUrl, heading, subtitle }: ModuleGridProps) {
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.url !== hideUrl) }))
        .filter((g) => g.items.length > 0),
    [groups, hideUrl],
  );

  if (visibleGroups.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No modules available. Ask an administrator for access.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {(heading || subtitle) && (
        <div>
          {heading && <h2 className="text-foreground text-xl font-semibold">{heading}</h2>}
          {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
        </div>
      )}

      {visibleGroups.map((group) => (
        <section key={group.label} className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            {group.label}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.url}
                  to={item.url}
                  className="group border-border hover:border-primary/40 bg-card hover:bg-accent/30 relative flex flex-col gap-3 rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="size-5" />
                    </div>
                    <h4 className="text-foreground flex-1 text-base font-semibold">{item.title}</h4>
                    <ArrowRight className="text-muted-foreground group-hover:text-primary size-4 transition-colors" />
                  </div>
                  {item.description && (
                    <p className="text-muted-foreground line-clamp-2 text-sm">{item.description}</p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
