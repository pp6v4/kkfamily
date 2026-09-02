CREATE TYPE "TaskType" AS ENUM ('TODO', 'REQUEST');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "type" "TaskType" NOT NULL DEFAULT 'TODO',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assigneeMembershipId" TEXT,
  "dueAt" TIMESTAMP(3),
  "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
  "reminderAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Task_reminder_check" CHECK ("reminderAt" IS NULL OR "dueAt" IS NULL OR "reminderAt" <= "dueAt")
);

CREATE TABLE "TaskHistory" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "actorMembershipId" TEXT NOT NULL,
  "fromStatus" "TaskStatus",
  "toStatus" "TaskStatus",
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_householdId_status_dueAt_id_idx" ON "Task"("householdId", "status", "dueAt", "id");
CREATE INDEX "Task_assigneeMembershipId_status_dueAt_idx" ON "Task"("assigneeMembershipId", "status", "dueAt");
CREATE INDEX "TaskHistory_taskId_createdAt_id_idx" ON "TaskHistory"("taskId", "createdAt", "id");

ALTER TABLE "Task" ADD CONSTRAINT "Task_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeMembershipId_fkey" FOREIGN KEY ("assigneeMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
