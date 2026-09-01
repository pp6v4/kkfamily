-- Recipe edits use optimistic locking so concurrent family edits never overwrite silently.
ALTER TABLE "Recipe" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
