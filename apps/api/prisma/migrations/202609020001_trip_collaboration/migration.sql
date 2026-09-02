CREATE TYPE "TripMemberRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "TripMemberStatus" AS ENUM ('ACTIVE', 'HISTORY', 'REVOKED');

ALTER TABLE "Trip"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "TripMember"
  ADD COLUMN "tripRole" "TripMemberRole" NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN "status" "TripMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftAt" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

WITH ranked AS (
  SELECT "tripId", "membershipId",
         ROW_NUMBER() OVER (PARTITION BY "tripId" ORDER BY "canEdit" DESC, "joinedAt" ASC, "membershipId" ASC) AS rn
  FROM "TripMember"
)
UPDATE "TripMember" tm
SET "tripRole" = 'OWNER', "canEdit" = TRUE
FROM ranked r
WHERE tm."tripId" = r."tripId" AND tm."membershipId" = r."membershipId" AND r.rn = 1;

CREATE TABLE "TripPreparationGroup" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripPreparationGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripPreparationGroupMember" (
  "groupId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  CONSTRAINT "TripPreparationGroupMember_pkey" PRIMARY KEY ("groupId", "membershipId")
);

ALTER TABLE "TripPackingItem"
  ADD COLUMN "sourceTemplateNameSnapshot" TEXT,
  ADD COLUMN "sourceItemNameSnapshot" TEXT,
  ADD COLUMN "groupId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "excludedAt" TIMESTAMP(3);

UPDATE "TripPackingItem" i
SET "sourceTemplateNameSnapshot" = t."name",
    "sourceItemNameSnapshot" = ti."name"
FROM "PackingTemplate" t, "PackingTemplateItem" ti
WHERE i."sourceTemplateId" = t."id" AND i."sourceTemplateItemId" = ti."id";

CREATE INDEX "TripMember_membershipId_status_idx" ON "TripMember"("membershipId", "status");
CREATE UNIQUE INDEX "TripPreparationGroup_tripId_name_key" ON "TripPreparationGroup"("tripId", "name");
CREATE INDEX "TripPreparationGroup_tripId_idx" ON "TripPreparationGroup"("tripId");
CREATE INDEX "TripPreparationGroupMember_tripId_membershipId_idx" ON "TripPreparationGroupMember"("tripId", "membershipId");
CREATE INDEX "TripPackingItem_groupId_idx" ON "TripPackingItem"("groupId");

ALTER TABLE "TripPreparationGroup" ADD CONSTRAINT "TripPreparationGroup_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPreparationGroupMember" ADD CONSTRAINT "TripPreparationGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TripPreparationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPreparationGroupMember" ADD CONSTRAINT "TripPreparationGroupMember_tripId_membershipId_fkey" FOREIGN KEY ("tripId", "membershipId") REFERENCES "TripMember"("tripId", "membershipId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPackingItem" ADD CONSTRAINT "TripPackingItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TripPreparationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
