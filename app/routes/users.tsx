import { Outlet } from "react-router";
import type { Route } from "./+types/users";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users - Greenbook" },
    { name: "description", content: "Browse users from Microsoft Graph" },
  ];
}

export default function Users() {
  return <Outlet />;
}
