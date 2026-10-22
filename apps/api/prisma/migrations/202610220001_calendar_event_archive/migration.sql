-- Preserve legacy calendar rows and their original source/creator/timestamps.
-- Only source-less anniversary rows are exposed to the legacy archive endpoint.
ALTER TABLE "CalendarEvent"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3);
