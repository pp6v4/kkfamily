CREATE TYPE "MediaOwnerType" AS ENUM ('RECIPE', 'TRIP', 'FAVORITE', 'ARCHIVE', 'TASK');
CREATE TYPE "UploadIntentStatus" AS ENUM ('PENDING', 'UPLOADED', 'CONFIRMED', 'EXPIRED', 'REJECTED');
CREATE TYPE "MediaAssetStatus" AS ENUM ('READY', 'REJECTED', 'DELETED');

CREATE TABLE "UploadIntent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "ownerType" "MediaOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "expectedOwnerVersion" INTEGER NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "declaredBytes" INTEGER NOT NULL,
  "uploadedBytes" INTEGER,
  "checksumSha256" TEXT,
  "status" "UploadIntentStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadIntent_declaredBytes_check" CHECK ("declaredBytes">0 AND "declaredBytes"<=8388608)
);
CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'READY',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MediaReference" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "ownerType" "MediaOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaReference_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Recipe" ADD COLUMN "coverAssetId" TEXT;

CREATE UNIQUE INDEX "UploadIntent_objectKey_key" ON "UploadIntent"("objectKey");
CREATE INDEX "UploadIntent_householdId_ownerType_ownerId_idx" ON "UploadIntent"("householdId", "ownerType", "ownerId");
CREATE INDEX "UploadIntent_expiresAt_status_idx" ON "UploadIntent"("expiresAt", "status");
CREATE UNIQUE INDEX "MediaAsset_intentId_key" ON "MediaAsset"("intentId");
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");
CREATE INDEX "MediaAsset_householdId_status_createdAt_idx" ON "MediaAsset"("householdId", "status", "createdAt");
CREATE UNIQUE INDEX "MediaReference_assetId_ownerType_ownerId_key" ON "MediaReference"("assetId", "ownerType", "ownerId");
CREATE INDEX "MediaReference_householdId_ownerType_ownerId_idx" ON "MediaReference"("householdId", "ownerType", "ownerId");
CREATE INDEX "Recipe_coverAssetId_idx" ON "Recipe"("coverAssetId");

ALTER TABLE "UploadIntent" ADD CONSTRAINT "UploadIntent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UploadIntent" ADD CONSTRAINT "UploadIntent_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "UploadIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaReference" ADD CONSTRAINT "MediaReference_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaReference" ADD CONSTRAINT "MediaReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
