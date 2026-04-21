import { createNotification } from "~/services/notifications.server";
import { prisma } from "~/utils/db/db.server";
import { logger } from "~/utils/monitoring/logger.server";

// Directory workflow notifications.
//
// Fire-and-forget: the approval engine calls these after its own writes
// have committed. Failures here MUST NOT unwind the change-request
// transaction, so each helper wraps in try/catch and logs.
//
// Recipients are resolved via permissions, not role names — a tenant can
// rename or compose roles however it likes and approvers will still be
// located as long as they hold `directory-change:approve`.

type ChangeNotificationSeed = {
  id: string;
  tenantId: string;
  entityType: string;
  operation: string;
  submittedById: string | null;
};

type Actor = { id: string; firstName: string | null; lastName: string | null };

function displayName(user: Actor | null | undefined, fallback: string): string {
  if (!user) return fallback;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || fallback;
}

/**
 * Notify every user in the tenant who holds `directory-change:approve`
 * (excluding the submitter themselves — dual-role users shouldn't review
 * their own submissions from their own inbox).
 */
export async function notifyManagersOfSubmission(
  change: ChangeNotificationSeed,
  submitter: Actor | null,
): Promise<void> {
  try {
    const reviewers = await prisma.user.findMany({
      where: {
        tenantId: change.tenantId,
        deletedAt: null,
        ...(change.submittedById ? { id: { not: change.submittedById } } : {}),
        userRoles: {
          some: {
            role: {
              rolePermissions: {
                some: {
                  permission: {
                    resource: "directory-change",
                    action: "approve",
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    const submitterName = displayName(submitter, "A focal person");
    const title = "New directory change to review";
    const message = `${submitterName} submitted a ${change.operation} for ${change.entityType}`;
    const data = {
      changeId: change.id,
      entityType: change.entityType,
      operation: change.operation,
    };

    await Promise.all(
      reviewers.map((u) =>
        createNotification({
          userId: u.id,
          tenantId: change.tenantId,
          type: "directory.change.submitted",
          title,
          message,
          data,
        }),
      ),
    );
  } catch (err) {
    logger.error({ err, changeId: change.id }, "failed to notify managers of submission");
  }
}

/**
 * Notify the submitter of an approve / reject decision. No-op when the
 * reviewer is the submitter (self-approved manager path) or when the
 * change was programmatic (no submittedById).
 */
export async function notifySubmitterOfDecision(
  change: ChangeNotificationSeed,
  outcome: "APPROVED" | "REJECTED",
  reviewer: Actor,
  notes: string | null,
): Promise<void> {
  if (!change.submittedById || change.submittedById === reviewer.id) return;
  try {
    const reviewerName = displayName(reviewer, "A reviewer");
    const verb = outcome === "APPROVED" ? "approved" : "rejected";
    const title =
      outcome === "APPROVED"
        ? "Your directory change was approved"
        : "Your directory change was rejected";
    const baseMessage = `${reviewerName} ${verb} your ${change.operation} for ${change.entityType}`;
    const message = notes ? `${baseMessage}: ${notes}` : baseMessage;

    await createNotification({
      userId: change.submittedById,
      tenantId: change.tenantId,
      type: `directory.change.${verb}`,
      title,
      message,
      data: {
        changeId: change.id,
        entityType: change.entityType,
        operation: change.operation,
        outcome,
      },
    });
  } catch (err) {
    logger.error({ err, changeId: change.id, outcome }, "failed to notify submitter of decision");
  }
}
