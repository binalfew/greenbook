import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/utils/misc";

interface RecentNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string | Date;
}

interface NotificationBellProps {
  tenantSlug: string;
  unreadCount: number;
  recent: RecentNotification[];
}

function formatAgo(
  createdAt: string | Date,
  t: (key: string, vars?: Record<string, unknown>) => string,
) {
  const then = new Date(createdAt).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return t("minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t("daysAgo", { count: diffDay });
}

export function NotificationBell({ tenantSlug, unreadCount, recent }: NotificationBellProps) {
  const { t } = useTranslation("notifications");
  const markAllFetcher = useFetcher();
  const base = `/${tenantSlug}/notifications`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("title")} className="relative">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className={cn("absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none")}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t("recent")}</span>
          {unreadCount > 0 && (
            <markAllFetcher.Form method="post" action={`${base}/mark-all-read`}>
              <button
                type="submit"
                className="text-muted-foreground text-xs font-normal underline-offset-4 hover:underline"
              >
                {t("markAllRead")}
              </button>
            </markAllFetcher.Form>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">{t("noRecent")}</div>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem key={n.id} asChild>
              <Link to={base} className="flex flex-col items-start gap-0.5">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", !n.read && "font-medium")}>
                    {n.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatAgo(n.createdAt, t)}
                  </span>
                </div>
                {n.message && (
                  <span className="text-muted-foreground truncate text-xs">{n.message}</span>
                )}
              </Link>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={base} className="justify-center text-xs">
            {t("viewAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
