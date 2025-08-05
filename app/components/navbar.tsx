import { Form, Link } from "react-router";
import logoAssetUrl from "~/assets/logo.svg";
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
        <Link to="/" className="flex items-center gap-4 cursor-pointer group">
          <img src={logoAssetUrl} alt="Logo" className="h-10 w-10 scale-175" />
          <span className="text-xl font-semibold text-white">Greenbook</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Form action="/logout" method="POST">
              <div className="flex h-5 items-center space-x-4 text-sm">
                <div>Welcome, {user.name || user.username || user.email}</div>
                {user.isAdmin && (
                  <>
                    <Separator orientation="vertical" />
                    <Link
                      to="/admin"
                      className="text-white hover:text-gray-200 transition-colors cursor-pointer"
                    >
                      Admin
                    </Link>
                  </>
                )}
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
          </>
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
