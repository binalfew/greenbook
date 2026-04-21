import crypto from "node:crypto";
import type { Invitation } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import type { ServiceContext, TenantServiceContext } from "~/utils/types.server";

const INVITE_EXPIRY_DAYS = 7;

export type CreateInvitationInput = {
  email: string;
  roleIds: string[];
};

export type InvitationWithTenant = Invitation & {
  tenant: { id: string; name: string; slug: string };
};

/**
 * Create a new invitation for the given email, scoped to the inviter's tenant.
 * Returns the Invitation row plus the plaintext token — the caller is
 * responsible for surfacing the token (email template in Phase 4; server-side
 * log in the meantime).
 */
export async function createInvitation(
  input: CreateInvitationInput,
  ctx: TenantServiceContext,
): Promise<Invitation> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      email: input.email.toLowerCase(),
      tenantId: ctx.tenantId,
      roleIds: input.roleIds,
      token,
      invitedById: ctx.userId,
      expiresAt,
    },
  });

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "INVITATION_SENT",
    entityType: "invitation",
    entityId: invitation.id,
    description: `Invited ${input.email} with ${input.roleIds.length} role(s)`,
    metadata: { email: input.email, roleIds: input.roleIds },
  });

  emitDomainEvent(ctx.tenantId, "invitation.created", {
    id: invitation.id,
    email: invitation.email,
    invitedById: ctx.userId,
  });

  return invitation;
}

export async function getInvitationByToken(token: string): Promise<InvitationWithTenant | null> {
  return prisma.invitation.findUnique({
    where: { token },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
}

/**
 * Attempt to accept an invitation on behalf of a user. Returns the accepted
 * invitation on success. Marks expired invitations as `EXPIRED` when it finds
 * them so they are not offered again. Throws on invalid/already-consumed
 * tokens so the caller can surface a user-facing error.
 */
export async function acceptInvitation(
  token: string,
  userId: string,
  ctx: ServiceContext,
): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) {
    throw new Error("Invitation not found");
  }
  if (invitation.status !== "PENDING") {
    throw new Error(`Invitation is already ${invitation.status.toLowerCase()}`);
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    await writeAudit({
      tenantId: invitation.tenantId,
      userId: ctx.userId,
      action: "INVITATION_EXPIRED",
      entityType: "invitation",
      entityId: invitation.id,
      description: "Invitation expired before acceptance",
    });
    throw new Error("Invitation has expired");
  }

  // Assign each invited role to the user. Skip silently on duplicate assignment.
  for (const roleId of invitation.roleIds) {
    await prisma.userRole.create({ data: { userId, roleId } }).catch(() => undefined);
  }

  const accepted = await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: "ACCEPTED" },
  });

  await writeAudit({
    tenantId: invitation.tenantId,
    userId,
    action: "INVITATION_ACCEPTED",
    entityType: "invitation",
    entityId: invitation.id,
    description: `User ${userId} accepted invitation to tenant ${invitation.tenantId}`,
  });

  emitDomainEvent(invitation.tenantId, "invitation.accepted", {
    id: invitation.id,
    userId,
    email: invitation.email,
  });

  return accepted;
}

export async function revokeInvitation(id: string, ctx: TenantServiceContext): Promise<Invitation> {
  const existing = await prisma.invitation.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error("Invitation not found");
  if (existing.status !== "PENDING") {
    throw new Error(`Cannot revoke an invitation that is ${existing.status.toLowerCase()}`);
  }

  const invitation = await prisma.invitation.update({
    where: { id },
    data: { status: "REVOKED" },
  });

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "INVITATION_REVOKED",
    entityType: "invitation",
    entityId: id,
    description: "Invitation revoked",
  });

  emitDomainEvent(ctx.tenantId, "invitation.revoked", {
    id: invitation.id,
    email: invitation.email,
  });

  return invitation;
}

export async function listInvitations(tenantId: string): Promise<Invitation[]> {
  return prisma.invitation.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
}
