import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";

// ─── Types ───────────────────────────────────────────────

interface CreateNotificationInput {
  userId: string;
  tenantId: string;
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

interface ListNotificationsOptions {
  page?: number;
  perPage?: number;
  type?: string;
  read?: boolean;
  search?: string;
}

// ─── Service Functions ───────────────────────────────────

export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      type: input.type,
      title: input.title,
      message: input.message,
      ...(input.data != null && { data: input.data }),
    },
  });

  return notification;
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

export async function listNotifications(userId: string, options: ListNotificationsOptions = {}) {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 20;
  const skip = (page - 1) * perPage;

  const where: Prisma.NotificationWhereInput = { userId };
  if (options.type) where.type = options.type;
  if (options.read !== undefined) where.read = options.read;
  if (options.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { message: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    notifications,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}

export async function markAsRead(id: string, userId: string) {
  return prisma.notification.update({
    where: { id, userId },
    data: { read: true, readAt: new Date() },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() },
  });
}

export async function deleteNotification(id: string, userId: string) {
  return prisma.notification.delete({
    where: { id, userId },
  });
}
