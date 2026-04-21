import { ArrowLeft, LogOut, Monitor, ShieldCheck } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { requireUserId } from "~/utils/auth/auth.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { sessionKey } from "~/utils/auth/constants";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { authSessionStorage } from "~/utils/auth/session.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/sessions";

export const handle = { breadcrumb: "Active Sessions" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Active sessions" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const currentSessionId = cookieSession.get(sessionKey) as string | undefined;

  const sessions = await prisma.session.findMany({
    where: { userId, deletedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });

  return data({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === currentSessionId,
    })),
    totalCount: sessions.length,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const intent = formData.get("intent");
  const cookieSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const currentSessionId = cookieSession.get(sessionKey) as string | undefined;

  if (intent === "sign-out-others") {
    await prisma.session.deleteMany({
      where: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
    });
    await writeAudit({
      userId,
      action: "LOGOUT",
      entityType: "session",
      description: "Signed out of all other sessions",
      request,
    });
  } else if (intent === "sign-out-session") {
    const sessionId = formData.get("sessionId");
    if (typeof sessionId === "string" && sessionId && sessionId !== currentSessionId) {
      // `deleteMany` with a userId filter so another user's session id can't
      // be targeted from this form.
      await prisma.session.deleteMany({ where: { id: sessionId, userId } });
      await writeAudit({
        userId,
        action: "LOGOUT",
        entityType: "session",
        entityId: sessionId,
        description: "Signed out of a specific session",
        request,
      });
    }
  }

  return redirect(`/${params.tenant}/profile/sessions`);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionsPage({ loaderData, params }: Route.ComponentProps) {
  const { sessions, totalCount } = loaderData;
  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/${params.tenant}/profile`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-foreground text-2xl font-bold">Active sessions</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your active sessions across devices. {totalCount} active{" "}
            {totalCount === 1 ? "session" : "sessions"}.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="size-5" />
            Sessions
          </CardTitle>
          <CardDescription>
            These are the devices currently logged in to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.map((session, index) => (
            <div key={session.id}>
              {index > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                    {session.isCurrent ? (
                      <ShieldCheck className="size-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <Monitor className="text-muted-foreground size-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {session.isCurrent ? "Current session" : "Session"}
                      </p>
                      {session.isCurrent && (
                        <Badge variant="secondary" className="text-xs">
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Started {formatDate(session.createdAt)} · Expires{" "}
                      {formatDate(session.expiresAt)}
                    </p>
                  </div>
                </div>
                {!session.isCurrent && (
                  <Form method="post">
                    <AuthenticityTokenInput />
                    <input type="hidden" name="intent" value="sign-out-session" />
                    <input type="hidden" name="sessionId" value={session.id} />
                    <Button variant="outline" size="sm" type="submit">
                      <LogOut className="mr-1.5 size-3.5" />
                      Sign out
                    </Button>
                  </Form>
                )}
              </div>
            </div>
          ))}

          {otherSessions.length > 0 && (
            <>
              <Separator />
              <Form method="post">
                <AuthenticityTokenInput />
                <input type="hidden" name="intent" value="sign-out-others" />
                <Button variant="outline" type="submit">
                  <LogOut className="mr-1.5 size-4" />
                  Sign out of all other sessions
                </Button>
              </Form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
