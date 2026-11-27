import { hash } from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import {
  action as changeExpiredPasswordAction,
  loader as changeExpiredPasswordLoader,
} from "~/routes/_auth/change-expired-password";
import { action as forgotPasswordAction } from "~/routes/_auth/forgot-password";
import { action as loginAction, loader as loginLoader } from "~/routes/_auth/login";
import { action as resetPasswordAction } from "~/routes/_auth/reset-password";
import { loader as ssoStartLoader } from "~/routes/_auth/sso/start";
import { action as verifyAction } from "~/routes/_auth/verify";
import { csrf } from "~/utils/auth/csrf.server";

// Sign-in paths that must keep working now that there is no second factor:
// password login, password reset by emailed code, expired-password change and
// the SSO entry point. Each test drives the route actions the way a browser
// would, carrying cookies from one response to the next request.

const ORIGIN = "http://localhost";
const PASSWORD = "Correct-Horse-1";
const NEW_PASSWORD = "Brand-New-Pass-2";
const DAY = 24 * 60 * 60 * 1000;

type RouteArgs = { request: Request; params: Record<string, string>; context: never };
type Handler = (args: never) => unknown;

/** Route handlers return either a `Response` or react-router's `data()` wrapper. */
function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  const wrapped = result as { data?: unknown; init?: ResponseInit | null };
  return Response.json(wrapped?.data ?? null, wrapped?.init ?? undefined);
}

/** Minimal cookie jar: remembers `Set-Cookie` values and replays them. */
function browser() {
  const jar = new Map<string, string>();

  function remember(setCookies: string[]) {
    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(setCookie)) jar.delete(name);
      else jar.set(name, value);
    }
  }

  function cookieHeader() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  async function run(handler: Handler, request: Request): Promise<Response> {
    let result: unknown;
    try {
      result = await (handler as (args: RouteArgs) => unknown)({
        request,
        params: {},
        context: undefined as never,
      });
    } catch (thrown) {
      if (!(thrown instanceof Response)) throw thrown;
      result = thrown;
    }
    const response = toResponse(result);
    remember(response.headers.getSetCookie());
    return response;
  }

  return {
    has: (name: string) => jar.has(name),
    get(handler: Handler, path: string) {
      return run(handler, new Request(`${ORIGIN}${path}`, { headers: { cookie: cookieHeader() } }));
    },
    async post(handler: Handler, path: string, fields: Record<string, string>) {
      const [token, csrfCookie] = await csrf.commitToken();
      if (csrfCookie) remember([csrfCookie]);
      return run(
        handler,
        new Request(`${ORIGIN}${path}`, {
          method: "POST",
          headers: {
            cookie: cookieHeader(),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ ...fields, csrf: token }),
        }),
      );
    },
  };
}

type Browser = ReturnType<typeof browser>;

async function createUser(options: { passwordChangedAt?: Date } = {}) {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  return prisma.user.create({
    data: {
      ...buildUser({ tenantId: tenant.id, userStatusId: status.id }),
      password: {
        create: {
          hash: await hash(PASSWORD, 4),
          ...(options.passwordChangedAt ? { lastChanged: options.passwordChangedAt } : {}),
        },
      },
    },
  });
}

function signIn(client: Browser, email: string, password: string) {
  return client.post(loginAction, "/login", { email, password });
}

/** A signed-in browser holds a session cookie that points at a live session row. */
async function expectSignedIn(response: Response, client: Browser, userId: string) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  expect(client.has("admin_session")).toBe(true);
  expect(await prisma.session.count({ where: { userId } })).toBe(1);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("password login", () => {
  it("signs the user in straight away, with no second step", async () => {
    const user = await createUser();
    const client = browser();

    const response = await signIn(client, user.email, PASSWORD);

    await expectSignedIn(response, client, user.id);
  });

  it("signs in an account that still carries a leftover second-factor record", async () => {
    const user = await createUser();
    await prisma.verification.create({
      data: {
        type: "2fa",
        target: user.id,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
        charSet: "0123456789",
      },
    });
    const client = browser();

    const response = await signIn(client, user.email, PASSWORD);

    await expectSignedIn(response, client, user.id);
  });

  it("rejects a wrong password", async () => {
    const user = await createUser();
    const client = browser();

    const response = await signIn(client, user.email, "not-the-password");

    expect(response.status).toBe(400);
    expect(client.has("admin_session")).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("password reset", () => {
  it("lets a user reset by emailed code and sign in with the new password", async () => {
    const user = await createUser();
    const client = browser();
    const sent: Array<{ to: string; html: string }> = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "email-1" });
    });

    const requested = await client.post(forgotPasswordAction, "/forgot-password", {
      email: user.email,
    });
    expect(requested.status).toBe(302);
    expect(new URL(requested.headers.get("location")!).pathname).toBe("/verify");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    const code = /<strong>(?:<!-- -->)?([A-Z0-9]+)<\/strong>/.exec(sent[0].html)?.[1];
    expect(code).toBeTruthy();

    const verified = await client.post(verifyAction, "/verify", {
      code: code!,
      type: "reset-password",
      target: user.email,
    });
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("/reset-password");

    const reset = await client.post(resetPasswordAction, "/reset-password", {
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(302);
    expect(reset.headers.get("location")).toBe("/login");

    expect((await signIn(client, user.email, PASSWORD)).status).toBe(400);
    await expectSignedIn(await signIn(client, user.email, NEW_PASSWORD), client, user.id);
  });

  it("rejects a wrong code", async () => {
    const user = await createUser();
    const client = browser();
    vi.stubGlobal("fetch", async () => Response.json({ id: "email-1" }));
    await client.post(forgotPasswordAction, "/forgot-password", { email: user.email });

    const verified = await client.post(verifyAction, "/verify", {
      code: "000000",
      type: "reset-password",
      target: user.email,
    });

    expect(verified.status).toBe(400);
    const reset = await client.post(resetPasswordAction, "/reset-password", {
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(reset.headers.get("location")).toBe("/forgot-password");
    await expectSignedIn(await signIn(client, user.email, PASSWORD), client, user.id);
  });
});

describe("expired password", () => {
  it("sends the user to change it, then lets them sign in with the new one", async () => {
    const user = await createUser({ passwordChangedAt: new Date(Date.now() - 100 * DAY) });
    const client = browser();

    const login = await signIn(client, user.email, PASSWORD);
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/change-expired-password");
    expect(client.has("admin_session")).toBe(false);

    const page = await client.get(changeExpiredPasswordLoader, "/change-expired-password");
    expect(page.status).toBe(200);

    const changed = await client.post(changeExpiredPasswordAction, "/change-expired-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(302);
    expect(changed.headers.get("location")).toBe("/login");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    await expectSignedIn(await signIn(client, user.email, NEW_PASSWORD), client, user.id);
  });

  it("does not show the change screen to a browser that has not just logged in", async () => {
    const page = await browser().get(changeExpiredPasswordLoader, "/change-expired-password");

    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login");
  });
});

describe("SSO sign-in", () => {
  it("is offered on the login page and hands the browser to the identity provider", async () => {
    const config = await prisma.sSOConfiguration.create({
      data: {
        provider: "CUSTOM_SAML",
        protocol: "SAML",
        displayName: "AU Staff Login",
        issuerUrl: "https://idp.example.org/saml/metadata",
        callbackUrl: `${ORIGIN}/sso/callback`,
        ssoUrl: "https://idp.example.org/saml/sso",
        spEntityId: "greenbook-test",
        x509Certificate: "MIIBfake",
      },
    });
    const client = browser();

    const page = await client.get(loginLoader, "/login");
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({
      ssoOptions: [{ id: config.id, provider: "CUSTOM_SAML", displayName: "AU Staff Login" }],
    });

    const start = await client.get(ssoStartLoader, `/sso/start?configId=${config.id}`);
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toMatch(/^https:\/\/idp\.example\.org\/saml\/sso\?/);
  });
});
