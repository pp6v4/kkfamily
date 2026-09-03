CREATE TYPE "FavoriteType" AS ENUM ('TEXT', 'IMAGE', 'LINK');
CREATE TYPE "FavoriteVisibility" AS ENUM ('PRIVATE', 'HOUSEHOLD');
CREATE TYPE "FavoriteConversionTarget" AS ENUM ('RECIPE', 'TASK');

CREATE TABLE "Favorite" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "type" "FavoriteType" NOT NULL,
  "title" TEXT NOT NULL,
  "text" TEXT,
  "sourceUrl" TEXT,
  "assetIds" JSONB NOT NULL DEFAULT '[]',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "visibility" "FavoriteVisibility" NOT NULL DEFAULT 'PRIVATE',
  "createdById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FavoriteConversion" (
  "id" TEXT NOT NULL,
  "favoriteId" TEXT NOT NULL,
  "targetType" "FavoriteConversionTarget" NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorMembershipId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavoriteConversion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Favorite_householdId_archivedAt_updatedAt_idx" ON "Favorite"("householdId", "archivedAt", "updatedAt");
CREATE INDEX "Favorite_createdById_visibility_archivedAt_idx" ON "Favorite"("createdById", "visibility", "archivedAt");
CREATE UNIQUE INDEX "FavoriteConversion_actorMembershipId_idempotencyKey_key" ON "FavoriteConversion"("actorMembershipId", "idempotencyKey");
CREATE INDEX "FavoriteConversion_favoriteId_createdAt_idx" ON "FavoriteConversion"("favoriteId", "createdAt");

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FavoriteConversion" ADD CONSTRAINT "FavoriteConversion_favoriteId_fkey" FOREIGN KEY ("favoriteId") REFERENCES "Favorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteConversion" ADD CONSTRAINT "FavoriteConversion_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
