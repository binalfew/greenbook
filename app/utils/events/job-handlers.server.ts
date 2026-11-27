import { sendEmail } from "~/utils/email/email.server";
import { registerJobHandler } from "~/utils/events/job-queue.server";
import { logger } from "~/utils/monitoring/logger.server";

/**
 * Payload shape for the `send-email` job. Restricted to JSON-serialisable
 * variants — the `react` element variant of `sendEmail` cannot round-trip
 * through the job queue.
 */
type SendEmailJobPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

registerJobHandler("send-email", async (payload) => {
  const options = payload as SendEmailJobPayload;
  await sendEmail(options);
});

logger.info("[jobs] send-email handler registered");
