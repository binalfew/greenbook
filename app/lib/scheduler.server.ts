import type { SyncSchedule } from "@prisma/client";
import * as cron from "node-cron";
import prisma from "./prisma";
import {
  incrementalSync,
  selectiveSync,
  type SyncOptions,
} from "./sync.server";

// Global scheduler instance
class SyncScheduler {
  private schedules: Map<string, cron.ScheduledTask> = new Map();
  private isInitialized = false;

  async initialize() {
    if (this.isInitialized) return;

    console.log("🚀 Initializing sync scheduler...");

    const schedules = await prisma.syncSchedule.findMany({
      where: { enabled: true },
    });

    for (const schedule of schedules) {
      await this.startSchedule(schedule);
    }

    this.isInitialized = true;
    console.log(`✅ Scheduler initialized with ${schedules.length} schedules`);
  }

  async startSchedule(schedule: SyncSchedule) {
    if (this.schedules.has(schedule.id)) return;

    console.log(`🔄 Starting schedule: ${schedule.name}`);

    const task = cron.schedule(
      schedule.cronExpression,
      async () => {
        await this.executeScheduledSync(schedule);
      },
      {
        timezone: "UTC",
      }
    );

    this.schedules.set(schedule.id, task);
    task.start();

    const nextRun = this.getNextRunTime(schedule.cronExpression);
    await prisma.syncSchedule.update({
      where: { id: schedule.id },
      data: { nextRun },
    });
  }

  async stopSchedule(scheduleId: string) {
    const task = this.schedules.get(scheduleId);
    if (task) {
      task.stop();
      this.schedules.delete(scheduleId);
    }
  }

  async stopAllSchedules() {
    for (const [scheduleId, task] of this.schedules) {
      task.stop();
    }
    this.schedules.clear();
    this.isInitialized = false;
  }

  private async executeScheduledSync(schedule: SyncSchedule) {
    console.log(`🔄 Executing scheduled sync: ${schedule.name}`);

    try {
      await prisma.syncSchedule.update({
        where: { id: schedule.id },
        data: { lastRun: new Date() },
      });

      let result: any;

      // Execute based on sync type
      switch (schedule.syncType) {
        case "incremental":
          result = await incrementalSync(
            schedule.syncOptions as SyncOptions,
            schedule.id
          );
          break;
        case "full":
          result = await selectiveSync(
            schedule.syncOptions as SyncOptions,
            schedule.id
          );
          break;
        case "selective":
          result = await selectiveSync(
            schedule.syncOptions as SyncOptions,
            schedule.id
          );
          break;
        default:
          throw new Error(`Unknown sync type: ${schedule.syncType}`);
      }

      console.log(`✅ Scheduled sync ${schedule.name} completed successfully`);

      // Update next run time
      const nextRun = this.getNextRunTime(schedule.cronExpression);
      await prisma.syncSchedule.update({
        where: { id: schedule.id },
        data: { nextRun },
      });
    } catch (error) {
      console.error(`❌ Scheduled sync ${schedule.name} failed:`, error);

      // Update next run time even on failure
      const nextRun = this.getNextRunTime(schedule.cronExpression);
      await prisma.syncSchedule.update({
        where: { id: schedule.id },
        data: { nextRun },
      });
    }
  }

  getNextRunTime(cronExpression: string): Date {
    const now = new Date();
    // For now, we'll calculate a simple next run time
    // In a production environment, you might want to use a more sophisticated library
    // like 'cron-parser' for accurate next run calculations
    const nextRun = new Date(now.getTime() + 60 * 60 * 1000); // Default to 1 hour from now
    return nextRun;
  }

  isScheduleRunning(scheduleId: string): boolean {
    return this.schedules.has(scheduleId);
  }
}

const scheduler = new SyncScheduler();

export async function createSchedule(data: {
  name: string;
  description?: string;
  syncType: "incremental" | "full" | "selective";
  cronExpression: string;
  syncOptions: SyncOptions;
  enabled?: boolean;
}): Promise<SyncSchedule> {
  if (!cron.validate(data.cronExpression)) {
    throw new Error("Invalid cron expression");
  }

  const schedule = await prisma.syncSchedule.create({
    data: {
      name: data.name,
      description: data.description,
      syncType: data.syncType,
      cronExpression: data.cronExpression,
      syncOptions: data.syncOptions as any,
      enabled: data.enabled ?? true,
      nextRun: scheduler.getNextRunTime(data.cronExpression),
    },
  });

  if (schedule.enabled) {
    await scheduler.startSchedule(schedule);
  }

  return schedule;
}

export async function updateSchedule(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    syncType: "incremental" | "full" | "selective";
    cronExpression: string;
    syncOptions: SyncOptions;
    enabled: boolean;
  }>
): Promise<SyncSchedule> {
  if (scheduler.isScheduleRunning(id)) {
    await scheduler.stopSchedule(id);
  }

  if (data.cronExpression && !cron.validate(data.cronExpression)) {
    throw new Error("Invalid cron expression");
  }

  const schedule = await prisma.syncSchedule.update({
    where: { id },
    data: {
      ...data,
      syncOptions: data.syncOptions as any,
      nextRun: data.cronExpression
        ? scheduler.getNextRunTime(data.cronExpression)
        : undefined,
    },
  });

  if (schedule.enabled) {
    await scheduler.startSchedule(schedule);
  }

  return schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  if (scheduler.isScheduleRunning(id)) {
    await scheduler.stopSchedule(id);
  }

  await prisma.syncSchedule.delete({
    where: { id },
  });
}

export async function toggleSchedule(
  id: string,
  enabled: boolean
): Promise<SyncSchedule> {
  const schedule = await prisma.syncSchedule.findUnique({
    where: { id },
  });

  if (!schedule) {
    throw new Error("Schedule not found");
  }

  if (enabled) {
    await scheduler.startSchedule(schedule);
  } else {
    await scheduler.stopSchedule(id);
  }

  return await prisma.syncSchedule.update({
    where: { id },
    data: { enabled },
  });
}

export async function getAllSchedules(): Promise<SyncSchedule[]> {
  return await prisma.syncSchedule.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function getScheduleById(
  id: string
): Promise<SyncSchedule | null> {
  return await prisma.syncSchedule.findUnique({
    where: { id },
  });
}

export async function initializeScheduler() {
  await scheduler.initialize();
}

export async function cleanupScheduler() {
  await scheduler.stopAllSchedules();
}

export { scheduler };
