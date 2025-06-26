/*
  Warnings:

  - You are about to drop the column `organId` on the `Department` table. All the data in the column will be lost.
  - You are about to drop the `Organ` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_organId_fkey";

-- AlterTable
ALTER TABLE "Department" DROP COLUMN "organId";

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "officeId" TEXT;

-- DropTable
DROP TABLE "Organ";

-- CreateTable
CREATE TABLE "Office" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Office_name_key" ON "Office"("name");

-- CreateIndex
CREATE INDEX "Staff_officeId_idx" ON "Staff"("officeId");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
