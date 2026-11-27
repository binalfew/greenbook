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
  return notifyManagersOfSubmissions([change], submitter);
}

/**
 * One notification per approver for a whole submission, however many change
 * requests it carries. All changes must share a tenant and a submitter.
 */
export async function notifyManagersOfSubmissions(
  changes: ChangeNotificationSeed[],
  submitter: Actor | null,
): Promise<void> {
  const change = changes[0];
  if (!change) return;
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
    const single = changes.length === 1;
    const title = single ? "New directory change to review" : "New directory changes to review";
    const message = single
      ? `${submitterName} submitted a ${change.operation} for ${change.entityType}`
      : `${submitterName} submitted ${changes.length} directory changes for review`;
    const data = single
      ? { changeId: change.id, entityType: change.entityType, operation: change.operation }
      : { changeIds: changes.map((c) => c.id), count: changes.length };

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

/**
 * The page, relative to the tenant, that a workflow notification is about:
 * the change itself, or the approval queue when one notification covers a
 * whole submission. Null for a notification this module did not send.
 */
export function directoryNotificationPath(notification: {
  type: string;
  data: unknown;
}): string | null {
  if (!notification.type.startsWith("directory.change.")) return null;
  const data = (notification.data ?? {}) as { changeId?: unknown; changeIds?: unknown };
  if (typeof data.changeId === "string") return `/directory/approvals/${data.changeId}`;
  if (Array.isArray(data.changeIds)) return "/directory/approvals";
  return null;
}
