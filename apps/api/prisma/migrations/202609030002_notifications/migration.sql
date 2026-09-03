CREATE TYPE "NotificationEventType" AS ENUM ('TASK_REMINDER');
CREATE TYPE "NotificationChannel" AS ENUM ('INBOX', 'WECHAT');
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSED');
CREATE TYPE "SubscriptionResult" AS ENUM ('ACCEPT', 'REJECT', 'BAN');

CREATE TABLE "NotificationPreference" (
  "membershipId" TEXT NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "leadMinutes" INTEGER NOT NULL DEFAULT 0,
  "quietStart" TEXT DEFAULT '22:00',
  "quietEnd" TEXT DEFAULT '08:00',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("membershipId", "eventType"),
  CONSTRAINT "NotificationPreference_leadMinutes_check" CHECK ("leadMinutes" >= 0 AND "leadMinutes" <= 525600)
);

CREATE TABLE "SubscriptionReceipt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "result" "SubscriptionResult" NOT NULL,
  "clientScene" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "SubscriptionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "payloadRedacted" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationJob" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "recipientMembershipId" TEXT NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "scheduleVersion" INTEGER NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboxItem" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "recipientMembershipId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "titleRedacted" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionReceipt_userId_templateId_recordedAt_idx" ON "SubscriptionReceipt"("userId", "templateId", "recordedAt");
CREATE UNIQUE INDEX "OutboxEvent_eventType_aggregateType_aggregateId_version_key" ON "OutboxEvent"("eventType", "aggregateType", "aggregateId", "version");
CREATE INDEX "OutboxEvent_householdId_createdAt_idx" ON "OutboxEvent"("householdId", "createdAt");
CREATE UNIQUE INDEX "NotificationJob_dedupeKey_key" ON "NotificationJob"("dedupeKey");
CREATE UNIQUE INDEX "NotificationJob_schedule_key" ON "NotificationJob"("recipientMembershipId", "eventType", "sourceId", "scheduleVersion", "channel");
CREATE INDEX "NotificationJob_status_scheduledAt_idx" ON "NotificationJob"("status", "scheduledAt");
CREATE INDEX "NotificationJob_recipientMembershipId_status_idx" ON "NotificationJob"("recipientMembershipId", "status");
CREATE UNIQUE INDEX "InboxItem_jobId_key" ON "InboxItem"("jobId");
CREATE INDEX "InboxItem_recipientMembershipId_readAt_createdAt_id_idx" ON "InboxItem"("recipientMembershipId", "readAt", "createdAt", "id");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionReceipt" ADD CONSTRAINT "SubscriptionReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_recipientMembershipId_fkey" FOREIGN KEY ("recipientMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "NotificationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_recipientMembershipId_fkey" FOREIGN KEY ("recipientMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
