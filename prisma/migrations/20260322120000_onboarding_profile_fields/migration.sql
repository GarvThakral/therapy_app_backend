-- AlterTable
ALTER TABLE "UserProfile"
ADD COLUMN "referralSource" TEXT,
ADD COLUMN "usageIntentions" TEXT[] DEFAULT ARRAY[]::TEXT[];
