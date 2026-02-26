/*
  Warnings:

  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT NOT NULL,
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';
