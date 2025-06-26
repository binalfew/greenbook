import { Outlet } from "react-router";

export default function Admin() {
  return (
    <div className="container mx-auto p-2 space-y-6">
      <Outlet />
    </div>
  );
}
