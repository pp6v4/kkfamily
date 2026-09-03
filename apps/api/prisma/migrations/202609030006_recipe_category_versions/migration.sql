ALTER TABLE "RecipeCategory"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

DROP INDEX "RecipeCategory_householdId_sortOrder_idx";

CREATE INDEX "RecipeCategory_householdId_archivedAt_sortOrder_idx"
  ON "RecipeCategory"("householdId", "archivedAt", "sortOrder");
