ALTER TABLE "PackingTemplate"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PackingTemplateItem"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

DROP INDEX "PackingTemplateItem_templateId_sortOrder_idx";

CREATE INDEX "PackingTemplateItem_templateId_archivedAt_sortOrder_idx"
  ON "PackingTemplateItem"("templateId", "archivedAt", "sortOrder");
