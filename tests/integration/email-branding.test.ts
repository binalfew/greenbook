import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as forgotPasswordAction } from "~/routes/_auth/forgot-password";
import { csrf } from "~/utils/auth/csrf.server";
import { honeypot } from "~/utils/auth/honeypot.server";

type SentEmail = { from: string; to: string; subject: string; html: string; text: string };

// The email provider is stubbed for this file: every send is captured here and
// anything else going out over HTTP fails the test, so no real email can leave.
const sent: SentEmail[] = [];
const server = setupServer(
  http.post("https://api.resend.com/emails", async ({ request }) => {
    sent.push((await request.json()) as SentEmail);
    return HttpResponse.json({ id: "mock-email-id" });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  sent.length = 0;
});
afterAll(() => server.close());

async function requestPasswordReset(email: string) {
  const form = new FormData();
  form.set("email", email);

  const [token, csrfCookie] = await csrf.commitToken();
  form.set("csrf", token);

  const honeypotProps = await honeypot.getInputProps();
  form.set(honeypotProps.nameFieldName, "");
  if (honeypotProps.validFromFieldName) {
    form.set(honeypotProps.validFromFieldName, honeypotProps.encryptedValidFrom);
  }

  const request = new Request("http://localhost/forgot-password", {
    method: "POST",
    body: form,
    headers: { Cookie: csrfCookie!.split(";")[0] },
  });

  try {
    return await forgotPasswordAction({ request, params: {}, context: {} } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

describe("outgoing email branding", () => {
  it("sends the password reset email as Greenbook, from the configured sender", async () => {
    const status = await seedActiveUserStatus(prisma);
    const tenant = await prisma.tenant.create({ data: buildTenant() });
    const user = await prisma.user.create({
      data: buildUser({ tenantId: tenant.id, userStatusId: status.id }),
    });

    const response = await requestPasswordReset(user.email);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);

    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email.to).toBe(user.email);
    expect(email.from).toBe("Greenbook Test <no-reply@greenbook.test>");
    expect(email.subject).toBe("Greenbook password reset");
    expect(email.html).toContain("Greenbook password reset");
    // The plain-text rendering upper-cases headings.
    expect(email.text).toMatch(/greenbook password reset/i);

    const everything = [email.from, email.subject, email.html, email.text].join("\n");
    expect(everything).not.toMatch(/accreditation/i);
    expect(everything).not.toMatch(/epic/i);
  });
});
