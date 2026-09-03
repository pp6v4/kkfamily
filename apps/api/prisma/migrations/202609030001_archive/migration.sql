CREATE TYPE "ArchiveValueType" AS ENUM ('TEXT', 'DATE', 'CONTACT', 'ADDRESS');
CREATE TYPE "ArchiveVisibility" AS ENUM ('MANAGERS', 'MEMBERS', 'SELECTED');

CREATE TABLE "ArchiveFieldDefinition" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "valueType" "ArchiveValueType" NOT NULL,
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "visibility" "ArchiveVisibility" NOT NULL DEFAULT 'MANAGERS',
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArchiveFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArchiveFieldValue" (
  "fieldId" TEXT NOT NULL,
  "valueCiphertext" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "updatedById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArchiveFieldValue_pkey" PRIMARY KEY ("fieldId")
);

CREATE TABLE "ArchiveFieldGrant" (
  "fieldId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "canRead" BOOLEAN NOT NULL DEFAULT true,
  "canEdit" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ArchiveFieldGrant_pkey" PRIMARY KEY ("fieldId", "membershipId")
);

CREATE UNIQUE INDEX "ArchiveFieldDefinition_householdId_key_key" ON "ArchiveFieldDefinition"("householdId", "key");
CREATE INDEX "ArchiveFieldDefinition_householdId_archivedAt_label_idx" ON "ArchiveFieldDefinition"("householdId", "archivedAt", "label");
CREATE INDEX "ArchiveFieldGrant_membershipId_canRead_idx" ON "ArchiveFieldGrant"("membershipId", "canRead");

ALTER TABLE "ArchiveFieldDefinition" ADD CONSTRAINT "ArchiveFieldDefinition_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArchiveFieldValue" ADD CONSTRAINT "ArchiveFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ArchiveFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArchiveFieldValue" ADD CONSTRAINT "ArchiveFieldValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArchiveFieldGrant" ADD CONSTRAINT "ArchiveFieldGrant_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ArchiveFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArchiveFieldGrant" ADD CONSTRAINT "ArchiveFieldGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
