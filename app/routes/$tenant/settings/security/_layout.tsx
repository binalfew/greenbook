import { Outlet } from "react-router";

export const handle = { breadcrumb: "Security" };

export default function Layout() {
  return <Outlet />;
}
