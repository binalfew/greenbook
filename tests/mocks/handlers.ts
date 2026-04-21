import { http, HttpResponse } from "msw";
import { requireHeader, writeEmail } from "./utils";

// MSW handlers intercept outbound HTTP during unit tests.
// Add new handlers here for any third-party API the app calls.
export const handlers = [
  // Resend API — email send endpoint. Captures the rendered email to
  // tests/fixtures/email/<recipient>.json so assertions can inspect it.
  http.post("https://api.resend.com/emails", async ({ request }) => {
    requireHeader(request.headers, "Authorization");
    const body = await request.json();
    const email = writeEmail(body);

    return HttpResponse.json({
      id: `mock-${Date.now()}`,
      from: email.from,
      to: email.to,
      created_at: new Date().toISOString(),
    });
  }),
];
