/*
  Warnings:

  - You are about to drop the column `fullName` on the `Staff` table. All the data in the column will be lost.
  - You are about to drop the column `reportsToId` on the `Staff` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[microsoftId]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userPrincipalName]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `displayName` to the `Staff` table without a default value. This is not possible if the table is not empty.
  - Added the required column `microsoftId` to the `Staff` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userPrincipalName` to the `Staff` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_jobTitleId_fkey";

-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_reportsToId_fkey";

-- AlterTable
ALTER TABLE "Staff" DROP COLUMN "fullName",
DROP COLUMN "reportsToId",
ADD COLUMN     "accountEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "businessPhones" TEXT[],
ADD COLUMN     "createdDateTime" TIMESTAMP(3),
ADD COLUMN     "department" TEXT,
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "employeeHireDate" TIMESTAMP(3),
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "employeeType" TEXT,
ADD COLUMN     "givenName" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastPasswordChangeDateTime" TIMESTAMP(3),
ADD COLUMN     "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "microsoftId" TEXT NOT NULL,
ADD COLUMN     "mobilePhone" TEXT,
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "surname" TEXT,
ADD COLUMN     "usageLocation" TEXT,
ADD COLUMN     "userPrincipalName" TEXT NOT NULL,
ADD COLUMN     "userType" TEXT,
ALTER COLUMN "jobTitleId" DROP NOT NULL,
ALTER COLUMN "departmentId" DROP NOT NULL,
ALTER COLUMN "employmentType" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserPhoto" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "photoData" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPhoto_staffId_key" ON "UserPhoto"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_microsoftId_key" ON "Staff"("microsoftId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userPrincipalName_key" ON "Staff"("userPrincipalName");

-- CreateIndex
CREATE INDEX "Staff_microsoftId_idx" ON "Staff"("microsoftId");

-- CreateIndex
CREATE INDEX "Staff_email_idx" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Staff_userPrincipalName_idx" ON "Staff"("userPrincipalName");

-- CreateIndex
CREATE INDEX "Staff_department_idx" ON "Staff"("department");

-- CreateIndex
CREATE INDEX "Staff_jobTitle_idx" ON "Staff"("jobTitle");

-- CreateIndex
CREATE INDEX "Staff_officeLocation_idx" ON "Staff"("officeLocation");

-- CreateIndex
CREATE INDEX "Staff_managerId_idx" ON "Staff"("managerId");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPhoto" ADD CONSTRAINT "UserPhoto_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
