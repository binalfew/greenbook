-- AlterTable
ALTER TABLE "SyncLog" ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "SyncSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "syncType" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "syncOptions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRun" TIMESTAMP(3),
    "nextRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncSchedule_name_key" ON "SyncSchedule"("name");

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "SyncSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
