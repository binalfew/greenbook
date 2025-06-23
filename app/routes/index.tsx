import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/lib/auth.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Greenbook" },
    { name: "description", content: "Greenbook" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const user = await requireUser(request);
    return { user };
  } catch {
    return { user: null };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (!loaderData.user) {
    return (
      <div className="container mx-auto py-20 flex flex-col items-center text-center">
        <div className="mb-8">
          <span className="text-5xl font-bold text-green-700">Greenbook</span>
        </div>
        <h1 className="text-3xl font-bold mb-4">Welcome to Greenbook</h1>
        <p className="text-lg text-gray-600 mb-8">
          Discover your Microsoft profile and connect with your organization.
        </p>
        <Form action="/auth/microsoft" method="POST">
          <Button type="submit" className="px-8 py-3 text-lg cursor-pointer">
            Login with Microsoft
          </Button>
        </Form>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-12">
      <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>View My Profile</CardTitle>
            <CardDescription>
              See your Microsoft profile information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-gray-600">
              Access your personal profile details, job title, department, and
              more from Microsoft Graph.
            </p>
            <Button asChild className="cursor-pointer">
              <Link to="/profile">View My Profile</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browse Users Directory</CardTitle>
            <CardDescription>Find people in your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-gray-600">
              Search and browse users from your Microsoft organization. Find
              colleagues by name, email, or department.
            </p>
            <Button asChild className="cursor-pointer">
              <Link to="/users">Browse Users</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
