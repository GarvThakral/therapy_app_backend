-- AlterTable
ALTER TABLE "TherapySession" ADD COLUMN "endDate" TIMESTAMP(3);

-- Backfill session endDate as the next session's start date
WITH ordered AS (
  SELECT
    "id",
    LEAD("date") OVER (
      PARTITION BY "userId"
      ORDER BY "date" ASC, "createdAt" ASC
    ) AS next_date
  FROM "TherapySession"
)
UPDATE "TherapySession" t
SET "endDate" = ordered.next_date
FROM ordered
WHERE t."id" = ordered."id";

-- CreateIndex
CREATE INDEX "TherapySession_userId_endDate_date_idx" ON "TherapySession"("userId", "endDate", "date");
