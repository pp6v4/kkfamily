-- CreateEnum
CREATE TYPE "PackingItemStatus" AS ENUM ('PENDING', 'PACKED');

-- CreateTable
CREATE TABLE "PackingTemplate" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PackingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultQuantity" DECIMAL(12,3),
    "unit" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PackingTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPackingItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "sourceTemplateItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "note" TEXT,
    "status" "PackingItemStatus" NOT NULL DEFAULT 'PENDING',
    "responsibleMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TripPackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackingTemplate_householdId_name_key" ON "PackingTemplate"("householdId", "name");
CREATE INDEX "PackingTemplate_householdId_archived_idx" ON "PackingTemplate"("householdId", "archived");
CREATE INDEX "PackingTemplateItem_templateId_sortOrder_idx" ON "PackingTemplateItem"("templateId", "sortOrder");
CREATE UNIQUE INDEX "TripPackingItem_tripId_sourceTemplateItemId_key" ON "TripPackingItem"("tripId", "sourceTemplateItemId");
CREATE INDEX "TripPackingItem_tripId_status_idx" ON "TripPackingItem"("tripId", "status");
CREATE INDEX "TripPackingItem_responsibleMembershipId_idx" ON "TripPackingItem"("responsibleMembershipId");

-- AddForeignKey
ALTER TABLE "PackingTemplate" ADD CONSTRAINT "PackingTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackingTemplate" ADD CONSTRAINT "PackingTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingTemplateItem" ADD CONSTRAINT "PackingTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PackingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPackingItem" ADD CONSTRAINT "TripPackingItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPackingItem" ADD CONSTRAINT "TripPackingItem_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "PackingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TripPackingItem" ADD CONSTRAINT "TripPackingItem_sourceTemplateItemId_fkey" FOREIGN KEY ("sourceTemplateItemId") REFERENCES "PackingTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TripPackingItem" ADD CONSTRAINT "TripPackingItem_responsibleMembershipId_fkey" FOREIGN KEY ("responsibleMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
