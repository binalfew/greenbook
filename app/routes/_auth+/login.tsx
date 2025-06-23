import { data, Form, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { authSessionStorage } from "~/lib/session.server";
import type { Route } from "./+types/login";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await authSessionStorage.getSession(
    request.headers.get("cookie")
  );
  const user = session.get("user");
  if (user) {
    return redirect("/");
  }

  return data({});
}

export default function Login() {
  const formAction = `/auth/microsoft`;

  return (
    <div className="h-[calc(100vh-4rem-4rem)] bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <svg
                width="48"
                height="48"
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-primary"
              >
                <path
                  d="M20 2L32 8V18C32 26.5 26.5 34 20 38C13.5 34 8 26.5 8 18V8L20 2Z"
                  fill="currentColor"
                  className="opacity-10"
                />
                <path
                  d="M20 4L30 9V18C30 25.5 25.5 32 20 36C14.5 32 10 25.5 10 18V9L20 4Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M14 24L18 20L22 22L26 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx="20"
                  cy="18"
                  r="6"
                  fill="currentColor"
                  className="opacity-20"
                />
                <path
                  d="M18 15C18 14.4 18.4 14 19 14H21C21.6 14 22 14.4 22 15C22 15.6 21.6 16 21 16H19V18H21C21.6 18 22 18.4 22 19C22 19.6 21.6 20 21 20H19C18.4 20 18 19.6 18 19V15Z"
                  fill="currentColor"
                />
                <line
                  x1="20"
                  y1="12"
                  x2="20"
                  y2="14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="20"
                  y1="20"
                  x2="20"
                  y2="22"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <CardTitle className="text-2xl font-semibold">PensionPro</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <Form action={formAction} method="POST">
              <Button type="submit" className="w-full">
                Continue with Microsoft
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
