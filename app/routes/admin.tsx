import {
  BarChart3,
  Briefcase,
  Building2,
  Clock,
  Key,
  Settings,
  Users,
} from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { NavLink, Outlet } from "react-router";
import { requireAdminUser } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminUser(request);
  return null;
}

export default function Admin() {
  const navItems = [
    {
      title: "Data Sync",
      href: "/admin/sync",
      icon: BarChart3,
      description: "Synchronize data from Microsoft Graph",
    },
    {
      title: "Schedules",
      href: "/admin/schedules",
      icon: Clock,
      description: "Manage automated sync schedules",
    },
    {
      title: "Offices",
      href: "/admin/offices",
      icon: Building2,
      description: "Manage office locations",
    },
    {
      title: "Departments",
      href: "/admin/departments",
      icon: Users,
      description: "Manage organizational departments",
    },
    {
      title: "Job Titles",
      href: "/admin/jobTitles",
      icon: Briefcase,
      description: "Manage job titles and positions",
    },
    {
      title: "Token Status",
      href: "/admin/token",
      icon: Key,
      description: "Check authentication token status",
    },
  ];

  return (
    <div className="min-h-screen">
      <div className="flex">
        {/* Left Sidebar */}
        <div className="w-64 bg-white shadow-lg min-h-screen">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-8">
              <Settings className="w-6 h-6 text-gray-600" />
              <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
            </div>

            <nav className="space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    className={({ isActive }) =>
                      `block p-3 rounded-lg transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                      }`
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5" />
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {item.description}
                        </div>
                      </div>
                    </div>
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <div className="p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
