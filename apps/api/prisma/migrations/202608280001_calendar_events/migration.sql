-- Calendar events are the date-oriented projection for meals, trips,
-- anniversaries and household tasks. The source fields intentionally stay
-- polymorphic so each business module remains the source of truth.
CREATE TYPE "CalendarEventType" AS ENUM ('ANNIVERSARY', 'MEAL', 'TRIP', 'TASK');

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "type" "CalendarEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "sourceType" TEXT,
  "sourceId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarEvent_householdId_startsAt_idx" ON "CalendarEvent"("householdId", "startsAt");
CREATE INDEX "CalendarEvent_householdId_sourceType_sourceId_idx" ON "CalendarEvent"("householdId", "sourceType", "sourceId");
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
