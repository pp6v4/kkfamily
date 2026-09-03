CREATE TYPE "AnniversaryRecurrence" AS ENUM ('ONCE', 'YEARLY');
CREATE TYPE "AnniversaryLeapPolicy" AS ENUM ('FEB_28', 'MAR_1', 'SKIP');

CREATE TABLE "Anniversary" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "recurrence" "AnniversaryRecurrence" NOT NULL DEFAULT 'YEARLY',
    "leapPolicy" "AnniversaryLeapPolicy" NOT NULL DEFAULT 'FEB_28',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Anniversary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Anniversary_householdId_archivedAt_idx" ON "Anniversary"("householdId", "archivedAt");

ALTER TABLE "Anniversary" ADD CONSTRAINT "Anniversary_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Anniversary" ADD CONSTRAINT "Anniversary_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Promote legacy, source-less anniversary events into the maintainable model.
-- IDs are deterministic so a repaired/replayed migration cannot create duplicates.
INSERT INTO "Anniversary" (
    "id", "householdId", "title", "localDate", "recurrence", "leapPolicy",
    "createdById", "createdAt", "updatedAt"
)
SELECT
    'legacy_' || event."id",
    event."householdId",
    event."title",
    to_char(event."startsAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
    'ONCE'::"AnniversaryRecurrence",
    'FEB_28'::"AnniversaryLeapPolicy",
    member."id",
    event."createdAt",
    event."updatedAt"
FROM "CalendarEvent" event
JOIN "Membership" member
  ON member."householdId" = event."householdId"
 AND member."userId" = event."createdById"
WHERE event."type" = 'ANNIVERSARY'
  AND event."sourceType" IS NULL
  AND event."sourceId" IS NULL;

DELETE FROM "CalendarEvent" event
USING "Anniversary" anniversary
WHERE anniversary."id" = 'legacy_' || event."id";
