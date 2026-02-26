-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT 'Alex',
    "therapistName" TEXT,
    "sessionFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "sessionDay" TEXT NOT NULL DEFAULT 'Thursday',
    "sessionTime" TEXT NOT NULL DEFAULT '10:00',
    "nextSessionDate" TIMESTAMP(3),
    "preSessionReminder" INTEGER NOT NULL DEFAULT 2,
    "postSessionReminder" INTEGER NOT NULL DEFAULT 1,
    "enablePreReminder" BOOLEAN NOT NULL DEFAULT true,
    "enablePostReminder" BOOLEAN NOT NULL DEFAULT true,
    "enableHomeworkReminder" BOOLEAN NOT NULL DEFAULT true,
    "enableWeeklyNudge" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "fontSize" TEXT NOT NULL DEFAULT 'standard',
    "aiSuggestions" BOOLEAN NOT NULL DEFAULT false,
    "onboarded" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "topics" TEXT[],
    "whatStoodOut" TEXT NOT NULL,
    "prepItems" TEXT[],
    "postMood" INTEGER NOT NULL,
    "moodWord" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "text" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "TherapySession_userId_date_idx" ON "TherapySession"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TherapySession_userId_number_key" ON "TherapySession"("userId", "number");

-- CreateIndex
CREATE INDEX "HomeworkItem_userId_completed_sessionDate_idx" ON "HomeworkItem"("userId", "completed", "sessionDate");

-- CreateIndex
CREATE INDEX "HomeworkItem_sessionId_idx" ON "HomeworkItem"("sessionId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkItem" ADD CONSTRAINT "HomeworkItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkItem" ADD CONSTRAINT "HomeworkItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TherapySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
