-- Fictional data for the isolated pre-upgrade schema. Never run in production.
INSERT INTO "User" ("id","openId","nickname","updatedAt") VALUES
('legacy-user-a','verification-legacy-a','虚构成员甲','2026-09-01'),
('legacy-user-b','verification-legacy-b','虚构成员乙','2026-09-01');
INSERT INTO "Household" ("id","name") VALUES ('legacy-house','虚构升级家庭');
INSERT INTO "Membership" ("id","householdId","userId","status") VALUES
('legacy-member-a','legacy-house','legacy-user-a','ACTIVE'),
('legacy-member-b','legacy-house','legacy-user-b','ACTIVE');
INSERT INTO "Ingredient" ("id","householdId","name","defaultUnit") VALUES ('legacy-food','legacy-house','番茄','g');
INSERT INTO "Recipe" ("id","householdId","name","steps","createdById","updatedAt")
VALUES ('legacy-recipe','legacy-house','虚构番茄菜','["炒熟"]','legacy-member-a','2026-09-01');
INSERT INTO "RecipeIngredient" ("recipeId","ingredientId","quantity","unit") VALUES ('legacy-recipe','legacy-food',200,'g');
INSERT INTO "RecipeSeasoning" ("id","recipeId","name") VALUES ('legacy-salt','legacy-recipe','盐');
INSERT INTO "InventoryItem" ("id","householdId","ingredientId","quantity","unit") VALUES ('legacy-stock','legacy-house','legacy-food',150,'g');
INSERT INTO "Meal" ("id","householdId","scheduledAt","mealType") VALUES ('legacy-meal','legacy-house','2026-09-01 23:30:00','早餐');
INSERT INTO "MealItem" ("id","mealId","recipeId","addedById") VALUES
('legacy-vote-a','legacy-meal','legacy-recipe','legacy-member-a'),
('legacy-vote-b','legacy-meal','legacy-recipe','legacy-member-b');
INSERT INTO "ShoppingList" ("id","householdId","name") VALUES ('legacy-list','legacy-house','下次超市');
INSERT INTO "ShoppingItem" ("id","listId","name","quantity","unit","sourceType") VALUES ('legacy-shopping','legacy-list','牛奶',2,'盒','MANUAL');
INSERT INTO "Trip" ("id","householdId","title","startsAt") VALUES ('legacy-trip','legacy-house','虚构露营','2026-09-03');
INSERT INTO "TripMember" ("tripId","membershipId","canEdit","joinedAt") VALUES
('legacy-trip','legacy-member-a',false,'2026-09-01'),
('legacy-trip','legacy-member-b',false,'2026-09-02');
INSERT INTO "CalendarEvent" ("id","householdId","type","title","startsAt","createdById","updatedAt") VALUES
('legacy-event-night','legacy-house','ANNIVERSARY','虚构跨日纪念日','2026-09-01 23:30:00','legacy-user-a','2026-09-01'),
('legacy-event-leap','legacy-house','ANNIVERSARY','虚构闰日纪念日','2024-02-28 16:00:00','legacy-user-a','2026-09-01');
