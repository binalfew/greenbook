import type { LucideIcon } from "lucide-react";
import { cn } from "~/utils/misc";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed p-12 text-center", className)}>
      {Icon && <Icon className="text-muted-foreground/40 mx-auto mb-3 size-10" />}
      <p className="text-muted-foreground font-medium">{title}</p>
      {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
