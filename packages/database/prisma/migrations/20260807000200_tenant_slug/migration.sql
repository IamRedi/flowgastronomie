-- Add a stable organization identifier without breaking existing tenants.
ALTER TABLE "Tenant" ADD COLUMN "slug" TEXT;
UPDATE "Tenant" SET "slug" = "id" WHERE "slug" IS NULL;
ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
