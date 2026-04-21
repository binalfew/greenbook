import { data, redirect } from "react-router";
import { z } from "zod";
import { prisma } from "~/utils/db/db.server";
import { requireGlobalAdmin } from "~/utils/auth/require-auth.server";
import { startImpersonating, stopImpersonating } from "~/utils/auth/session.server";
import type { Route } from "./+types/impersonate";

const ImpersonateSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("start"),
    targetUserId: z.string().min(1, "targetUserId is required"),
    redirectTo: z.string().optional(),
  }),
  z.object({
    intent: z.literal("stop"),
    redirectTo: z.string().optional(),
  }),
]);

export async function loader() {
  throw redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = ImpersonateSchema.safeParse({
    intent: formData.get("intent"),
    targetUserId: formData.get("targetUserId") ?? undefined,
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    return data({ error: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;

  if (input.intent === "stop") {
    return stopImpersonating(request, input.redirectTo ?? "/");
  }

  // Only global admins may START impersonation. Stopping is always allowed so a
  // user can always exit impersonation state without extra privilege checks.
  await requireGlobalAdmin(request);

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true },
  });
  if (!target) {
    return data({ error: "Target user not found" }, { status: 404 });
  }

  return startImpersonating(request, input.targetUserId, input.redirectTo ?? "/");
}
