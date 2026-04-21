import { Outlet } from "react-router";

export const handle = { breadcrumb: "Settings" };

export default function SettingsLayout() {
  return <Outlet />;
}
