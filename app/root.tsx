import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { useEffect } from "react";
import { AuthenticityTokenProvider } from "remix-utils/csrf/react";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { Toaster } from "sonner";
import type { Route } from "./+types/root";
import "./app.css";
import { ImpersonationBanner } from "./components/impersonation-banner";
import { InstallPrompt } from "./components/pwa/install-prompt";
import { SwUpdatePrompt } from "./components/pwa/sw-update-prompt";
import { useToast } from "./components/toaster";
import { FEATURE_FLAG_KEYS } from "./utils/config/feature-flag-keys";
import { isFeatureEnabled } from "./utils/config/feature-flags.server";
import { initSentryClient } from "./utils/monitoring/sentry.client";
import { registerServiceWorker } from "./utils/offline/sw-register";
import { getUser, getUserId, logout } from "./utils/auth/auth.server";
import { getImpersonationState } from "./utils/auth/session.server";
import { ClientHintCheck, getHints } from "./utils/client-hints";
import { csrf } from "./utils/auth/csrf.server";
import { getEnv } from "./utils/config/env.server";
import { initI18n } from "./utils/i18n";
import { pipeHeaders } from "./utils/headers.server";
import { honeypot } from "./utils/auth/honeypot.server";
import { useNonce } from "./utils/nonce-provider";
import { getTheme } from "./utils/theme.server";
import { makeTimings, time } from "./utils/monitoring/timing.server";
import { getToast } from "./utils/toast.server";
import { combineHeaders, getDomainUrl } from "./utils/misc";
import { prisma } from "./utils/db/db.server";
import { getLangFromRequest } from "./utils/i18n-cookie.server";
import { useOptionalTheme, useTheme } from "./routes/resources/theme-switch";

export const meta: Route.MetaFunction = ({ data }) => {
  return [{ title: data ? "Admin" : "Error | Admin" }, { name: "description", content: `Admin` }];
};

export const headers: Route.HeadersFunction = pipeHeaders;

export async function loader({ request }: Route.LoaderArgs) {
  const timings = makeTimings("root loader");
  const userId = await time(() => getUserId(request), {
    timings,
    type: "getUserId",
    desc: "getUserId in root",
  });
  const user = userId ? await getUser(userId) : null;

  if (userId && !user) {
    console.info("something weird happened");
    // something weird happened... The user is authenticated but we can't find
    // them in the database. Maybe they were deleted? Let's log them out.
    throw await logout({ request, redirectTo: "/" });
  }

  // When an admin is impersonating another user, surface both identities to the
  // banner so the admin always knows which account is "live".
  const impersonationState = await getImpersonationState(request);
  const originalUser =
    impersonationState.isImpersonating && impersonationState.originalUserId
      ? await prisma.user.findUnique({
          where: { id: impersonationState.originalUserId },
          select: { email: true },
        })
      : null;
  const impersonation =
    impersonationState.isImpersonating && user && originalUser
      ? { impersonatedEmail: user.email, originalEmail: originalUser.email }
      : null;

  const { toast, headers: toastHeaders } = await getToast(request);
  const [csrfToken, csrfCookieHeader] = await csrf.commitToken(request);
  const honeyProps = await honeypot.getInputProps();

  // Resolve the UI language for this request. Defaults to `en` when the cookie
  // is absent or names an unsupported locale.
  const lang = getLangFromRequest(request) ?? "en";

  // Gate PWA plumbing (service worker + manifest + install/update prompts) on
  // the global FF_PWA flag. Flag off = template behaves like a plain web app.
  const pwaEnabled = await isFeatureEnabled(FEATURE_FLAG_KEYS.PWA);

  return data(
    {
      user,
      impersonation,
      lang,
      pwaEnabled,
      requestInfo: {
        hints: getHints(request),
        origin: getDomainUrl(request),
        path: new URL(request.url).pathname,
        userPrefs: {
          theme: getTheme(request),
        },
      },
      ENV: getEnv(),
      toast,
      honeyProps,
      csrfToken,
    },
    {
      headers: combineHeaders(
        { "Server-Timing": timings.toString() },
        csrfCookieHeader ? { "set-cookie": csrfCookieHeader } : null,
        toastHeaders,
      ),
    },
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData("root") as
    | { ENV?: Record<string, unknown>; lang?: string; pwaEnabled?: boolean }
    | undefined;
  const tenantData = useRouteLoaderData("routes/$tenant/_layout") as
    | { tenant?: { brandTheme?: string } }
    | undefined;
  // Tenant-less routes (login, signup, /directory/*) surface their own
  // brandTheme resolved from the `brand` cookie so the AU look carries
  // across the whole site.
  const authData = useRouteLoaderData("routes/_auth/_layout") as
    | { brandTheme?: string }
    | undefined;
  const publicDirectoryData = useRouteLoaderData("routes/directory/_layout") as
    | { brandTheme?: string }
    | undefined;
  const nonce = useNonce();
  const theme = useOptionalTheme();
  const lang = data?.lang ?? "en";
  const pwaEnabled = data?.pwaEnabled ?? false;
  const brandTheme =
    tenantData?.tenant?.brandTheme || authData?.brandTheme || publicDirectoryData?.brandTheme || "";

  // Initialise i18n on both the server render and the client hydration so
  // components resolve translations identically. `initI18n` is idempotent —
  // subsequent calls only switch the active language when it differs.
  initI18n(lang);

  return (
    <html
      lang={lang}
      className={`${theme}`}
      data-brand={brandTheme || undefined}
      data-pwa={pwaEnabled ? "true" : undefined}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {pwaEnabled && (
          <>
            <link rel="manifest" href="/manifest.json" />
            <meta name="theme-color" content="#1e40af" />
            <meta name="mobile-web-app-capable" content="yes" />
          </>
        )}
        <ClientHintCheck nonce={nonce} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(data?.ENV)}`,
          }}
        />
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const theme = useTheme();
  useToast(loaderData.toast);

  useEffect(() => {
    if (loaderData.pwaEnabled) {
      registerServiceWorker();
    }
  }, [loaderData.pwaEnabled]);

  useEffect(() => {
    // SENTRY_DSN is exposed via getEnv() → window.ENV.
    initSentryClient(loaderData.ENV?.SENTRY_DSN);
  }, [loaderData.ENV?.SENTRY_DSN]);

  return (
    <AuthenticityTokenProvider token={loaderData.csrfToken}>
      <HoneypotProvider {...loaderData.honeyProps}>
        {loaderData.impersonation && (
          <ImpersonationBanner
            impersonatedEmail={loaderData.impersonation.impersonatedEmail}
            originalEmail={loaderData.impersonation.originalEmail}
          />
        )}
        <div className="min-h-screen">
          <Outlet />
          <Toaster position="top-center" theme={theme} />
        </div>
        {loaderData.pwaEnabled && (
          <>
            <InstallPrompt />
            <SwUpdatePrompt />
          </>
        )}
      </HoneypotProvider>
    </AuthenticityTokenProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
