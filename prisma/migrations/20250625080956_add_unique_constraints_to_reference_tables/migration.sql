/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Department` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[title]` on the table `JobTitle` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_organId_fkey";

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "organId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_title_key" ON "JobTitle"("title");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organId_fkey" FOREIGN KEY ("organId") REFERENCES "Organ"("id") ON DELETE SET NULL ON UPDATE CASCADE;
