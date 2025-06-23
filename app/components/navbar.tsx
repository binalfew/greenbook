import { Form } from "react-router";
import { Button } from "~/components/ui/button";
import type { User } from "~/types/user";
import { Separator } from "./ui/separator";

export default function Navbar({ user }: { user: User | undefined }) {
  const formAction = "/auth/microsoft";

  return (
    <header
      className="text-white px-4 py-2 flex items-center justify-between"
      style={{ backgroundColor: "#40734b" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
          <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
            <div className="w-4 h-4 bg-orange-500 rounded-full relative">
              <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white rounded-full"></div>
              <div className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-white rounded-full"></div>
            </div>
          </div>
        </div>
        <h1 className="text-xl font-semibold">Greenbook</h1>
      </div>

      <div className="flex items-center gap-4">
        {user ? (
          <Form action="/logout" method="POST">
            <div className="flex h-5 items-center space-x-4 text-sm">
              <div>Welcome, {user.name || user.username || user.email}</div>
              <Separator orientation="vertical" />
              <Button
                variant="link"
                type="submit"
                className="text-white flex items-center gap-2 cursor-pointer"
              >
                Logout
              </Button>
            </div>
          </Form>
        ) : (
          <Form action={formAction} method="POST">
            <Button
              type="submit"
              variant="link"
              className="text-white flex items-center gap-2 cursor-pointer"
            >
              Login
            </Button>
          </Form>
        )}
      </div>
    </header>
  );
}
