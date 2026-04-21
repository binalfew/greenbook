import { useCallback, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "~/components/ui/sidebar";
import type { NavChild, NavGroup } from "~/config/navigation";

const GROUPS_COOKIE = "sidebar_groups";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function isSegmentPrefix(pathname: string, url: string): boolean {
  if (pathname === url) return true;
  // Ensure match is at a segment boundary (followed by / or end)
  return pathname.startsWith(url) && (url.endsWith("/") || pathname[url.length] === "/");
}

function isPathActive(pathname: string, url: string, end?: boolean): boolean {
  return end ? pathname === url : isSegmentPrefix(pathname, url);
}

function isChildActive(pathname: string, child: NavChild, siblings: NavChild[]): boolean {
  // Non-end items: segment-aware prefix match
  if (!child.end) return isSegmentPrefix(pathname, child.url);
  // end items: exact match OR prefix match when no sibling claims the path
  if (pathname === child.url) return true;
  if (!isSegmentPrefix(pathname, child.url)) return false;
  // Fallback: activate this end-item if no other sibling matches
  return !siblings.some((s) => s !== child && isSegmentPrefix(pathname, s.url));
}

export function NavMain({
  groups,
  groupState,
}: {
  groups: NavGroup[];
  groupState: Record<string, boolean>;
}) {
  const location = useLocation();
  const { t } = useTranslation("nav");
  const { state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === "collapsed";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      for (const item of group.items) {
        if (item.children) {
          initial[item.title] = groupState[item.title] ?? true;
        }
      }
    }
    return initial;
  });

  const handleGroupToggle = useCallback((label: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: open };
      document.cookie = `${GROUPS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${COOKIE_MAX_AGE}`;
      return next;
    });
  }, []);

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.tKey ? t(group.tKey) : group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) =>
              item.children ? (
                isCollapsed ? (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.tKey ? t(item.tKey) : item.title}
                      isActive={isSegmentPrefix(location.pathname, item.url)}
                      asChild
                    >
                      <NavLink to={item.url}>
                        <item.icon />
                        <span>{item.tKey ? t(item.tKey) : item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  <Collapsible
                    key={item.title}
                    asChild
                    open={openGroups[item.title]}
                    onOpenChange={(open) => handleGroupToggle(item.title, open)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={item.tKey ? t(item.tKey) : item.title}>
                          <item.icon />
                          <span>{item.tKey ? t(item.tKey) : item.title}</span>
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.title}>
                              <SidebarMenuSubButton
                                isActive={isChildActive(location.pathname, child, item.children!)}
                                asChild
                              >
                                <NavLink to={child.url} end={child.end}>
                                  <span>{child.tKey ? t(child.tKey) : child.title}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )
              ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.tKey ? t(item.tKey) : item.title}
                    isActive={isPathActive(location.pathname, item.url, item.end)}
                    asChild
                  >
                    <NavLink to={item.url} end={item.end}>
                      <item.icon />
                      <span>{item.tKey ? t(item.tKey) : item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ),
            )}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
