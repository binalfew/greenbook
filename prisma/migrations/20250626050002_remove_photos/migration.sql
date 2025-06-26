/*
  Warnings:

  - You are about to drop the column `gender` on the `Staff` table. All the data in the column will be lost.
  - You are about to drop the column `photoUrl` on the `Staff` table. All the data in the column will be lost.
  - You are about to drop the `UserPhoto` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserPhoto" DROP CONSTRAINT "UserPhoto_staffId_fkey";

-- AlterTable
ALTER TABLE "Staff" DROP COLUMN "gender",
DROP COLUMN "photoUrl";

-- DropTable
DROP TABLE "UserPhoto";
