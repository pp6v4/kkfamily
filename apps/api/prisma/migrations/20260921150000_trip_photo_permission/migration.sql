-- Preserve existing photo capability; the household trips:EDIT check remains.
ALTER TABLE "TripMember" ADD COLUMN "photoAdd" BOOLEAN NOT NULL DEFAULT false;
UPDATE "TripMember" SET "photoAdd" = "canEdit";
