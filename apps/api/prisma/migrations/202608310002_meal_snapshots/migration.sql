-- Non-destructive migration. Duplicate legacy meal slots must be reviewed, never silently merged.
CREATE TYPE "IngredientKind" AS ENUM ('FOOD', 'SEASONING');
CREATE TYPE "StockAvailability" AS ENUM ('PRESENT', 'ABSENT', 'UNKNOWN');
ALTER TABLE "Ingredient" ADD COLUMN "kind" "IngredientKind" NOT NULL DEFAULT 'FOOD';
DROP INDEX "Ingredient_householdId_name_key";
CREATE UNIQUE INDEX "Ingredient_householdId_name_kind_key" ON "Ingredient"("householdId", "name", "kind");
ALTER TABLE "RecipeSeasoning" ADD COLUMN "ingredientId" TEXT;
INSERT INTO "Ingredient" ("id", "householdId", "name", "defaultUnit", "kind")
SELECT 'seasoning-' || md5(r."householdId" || ':' || s."name"), r."householdId", s."name", '', 'SEASONING'
FROM "RecipeSeasoning" s JOIN "Recipe" r ON r."id"=s."recipeId"
GROUP BY r."householdId", s."name";
UPDATE "RecipeSeasoning" s SET "ingredientId"=i."id" FROM "Recipe" r, "Ingredient" i
WHERE r."id"=s."recipeId" AND i."householdId"=r."householdId" AND i."name"=s."name" AND i."kind"='SEASONING';
ALTER TABLE "RecipeSeasoning" ADD CONSTRAINT "RecipeSeasoning_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ALTER COLUMN "quantity" DROP NOT NULL;
ALTER TABLE "InventoryItem" ADD COLUMN "availability" "StockAvailability" NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
UPDATE "InventoryItem" SET "availability"=CASE WHEN "quantity"=0 THEN 'ABSENT'::"StockAvailability" ELSE 'PRESENT'::"StockAvailability" END;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_quantity_nonnegative" CHECK ("quantity" IS NULL OR "quantity">=0);
ALTER TABLE "InventoryTransaction" ADD COLUMN "actorMembershipId" TEXT, ADD COLUMN "sourceType" TEXT, ADD COLUMN "sourceId" TEXT, ADD COLUMN "sourceVersion" INTEGER,
 ADD COLUMN "beforeQuantity" DECIMAL(12,3), ADD COLUMN "afterQuantity" DECIMAL(12,3), ADD COLUMN "beforeAvailability" "StockAvailability", ADD COLUMN "afterAvailability" "StockAvailability";
ALTER TABLE "InventoryTransaction" ALTER COLUMN "quantityDelta" DROP NOT NULL;
CREATE UNIQUE INDEX "InventoryTransaction_source_key" ON "InventoryTransaction"("inventoryItemId", "sourceType", "sourceId", "sourceVersion");
ALTER TABLE "Meal" ADD COLUMN "localDate" TEXT, ADD COLUMN "slotKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "snapshotVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "completedFromVersion" INTEGER;
UPDATE "Meal" SET "localDate"=to_char("scheduledAt"+interval '8 hours','YYYY-MM-DD'),
 "mealType"=CASE "mealType" WHEN '早餐' THEN 'BREAKFAST' WHEN '午餐' THEN 'LUNCH' WHEN '晚餐' THEN 'DINNER' WHEN '加餐' THEN 'OTHER' ELSE "mealType" END;
ALTER TABLE "Meal" ALTER COLUMN "localDate" SET NOT NULL;
CREATE UNIQUE INDEX "Meal_householdId_localDate_mealType_slotKey_key" ON "Meal"("householdId","localDate","mealType","slotKey");
CREATE TABLE "MealDish" ("mealId" TEXT NOT NULL, "recipeId" TEXT NOT NULL, "cookMultiplier" DECIMAL(8,3) NOT NULL DEFAULT 1,
 CONSTRAINT "MealDish_pkey" PRIMARY KEY ("mealId","recipeId"), CONSTRAINT "MealDish_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MealDish_multiplier_positive" CHECK ("cookMultiplier">0));
INSERT INTO "MealDish" ("mealId","recipeId") SELECT DISTINCT "mealId","recipeId" FROM "MealItem";
CREATE TABLE "MealSnapshot" ("id" TEXT NOT NULL, "mealId" TEXT NOT NULL, "version" INTEGER NOT NULL, "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "data" JSONB NOT NULL,
 CONSTRAINT "MealSnapshot_pkey" PRIMARY KEY ("id"), CONSTRAINT "MealSnapshot_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "MealSnapshot_mealId_version_key" ON "MealSnapshot"("mealId","version");
ALTER TABLE "ShoppingList" ADD COLUMN "systemKey" TEXT;
UPDATE "ShoppingList" SET "systemKey"='NEXT_TRIP' WHERE "id" IN (SELECT MIN("id") FROM "ShoppingList" WHERE "name"='下次超市' GROUP BY "householdId");
CREATE UNIQUE INDEX "ShoppingList_householdId_systemKey_key" ON "ShoppingList"("householdId","systemKey");
ALTER TABLE "ShoppingItem" ADD COLUMN "sourceVersion" INTEGER, ADD COLUMN "sourceItemKey" TEXT, ADD COLUMN "previousItemId" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "purchasedAt" TIMESTAMP(3), ADD COLUMN "purchasedById" TEXT;
CREATE UNIQUE INDEX "ShoppingItem_source_key" ON "ShoppingItem"("listId","sourceType","sourceId","sourceVersion","sourceItemKey");
