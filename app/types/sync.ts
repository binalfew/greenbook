import { z } from "zod";

// Sync Types
export type SyncType =
  | "users"
  | "hierarchy"
  | "reference_data"
  | "link_references"
  | "full_sync"
  | "selective_sync"
  | "incremental_sync";

export type SyncStatus =
  | "running"
  | "success"
  | "error"
  | "partial"
  | "cancelled";

export type ScheduleSyncType = "incremental" | "full" | "selective";

// Sync Options
export interface SyncOptions {
  users?: boolean;
  referenceData?: boolean;
  hierarchy?: boolean;
  linkReferences?: boolean;
}

// Sync Results
export interface SyncResult {
  recordsProcessed: number;
  recordsFailed: number;
  status: SyncStatus;
  message?: string | null;
}

export interface SyncResults {
  usersSync?: SyncResult;
  referenceDataSync?: SyncResult;
  linkReferencesSync?: SyncResult;
  hierarchySync?: SyncResult;
}

// Sync Log with Child Details
export interface SyncLogWithDetails {
  id: string;
  syncType: SyncType;
  status: SyncStatus;
  message?: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  masterSyncLogId?: string;
  scheduleId?: string;
  childLogs?: SyncLogDetail[];
  totalProcessed: number;
  totalFailed: number;
}

export interface SyncLogDetail {
  id: string;
  syncType: SyncType;
  status: SyncStatus;
  recordsProcessed: number;
  recordsFailed: number;
  startedAt: Date;
  completedAt?: Date | null;
}

// Zod schemas for runtime validation
export const SyncOptionsSchema = z.object({
  users: z.boolean().optional(),
  referenceData: z.boolean().optional(),
  hierarchy: z.boolean().optional(),
  linkReferences: z.boolean().optional(),
});

export const SyncResultSchema = z.object({
  recordsProcessed: z.number(),
  recordsFailed: z.number(),
  status: z.enum(["running", "success", "error", "partial", "cancelled"]),
  message: z.string().nullable().optional(),
});

export const SyncResultsSchema = z.object({
  usersSync: SyncResultSchema.optional(),
  referenceDataSync: SyncResultSchema.optional(),
  linkReferencesSync: SyncResultSchema.optional(),
  hierarchySync: SyncResultSchema.optional(),
});
