-- CreateTable
CREATE TABLE "LaunchPromoGrant" (
    "id" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "grantedPlan" "Plan" NOT NULL DEFAULT 'PRO',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchPromoGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchPromoGrant_userId_key" ON "LaunchPromoGrant"("userId");

-- CreateIndex
CREATE INDEX "LaunchPromoGrant_campaign_createdAt_idx" ON "LaunchPromoGrant"("campaign", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchPromoGrant_campaign_email_key" ON "LaunchPromoGrant"("campaign", "email");

-- AddForeignKey
ALTER TABLE "LaunchPromoGrant" ADD CONSTRAINT "LaunchPromoGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
