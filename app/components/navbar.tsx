import { LogOut } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";

export default function Navbar() {
  return (
    <header
      className="text-white px-4 py-2 flex items-center justify-between"
      style={{ backgroundColor: "#40734b" }}
    >
      {/* Left side - Jenkins logo and title */}
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

      {/* Right side - Search, User menu, Logout */}
      <div className="flex items-center gap-4">
        {/* Search button */}

        {/* Logout button */}
        <Button
          variant="link"
          size="sm"
          className="text-white flex items-center gap-2"
          asChild
        >
          <Link to="/logout">
            <LogOut className="w-4 h-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
