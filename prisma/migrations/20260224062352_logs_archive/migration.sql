-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('trigger', 'event', 'thought', 'win');

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "intensity" INTEGER NOT NULL,
    "addedToPrep" BOOLEAN NOT NULL DEFAULT false,
    "prepNote" TEXT,
    "checkedOff" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogEntry_userId_createdAt_idx" ON "LogEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_userId_isArchived_createdAt_idx" ON "LogEntry"("userId", "isArchived", "createdAt");

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
