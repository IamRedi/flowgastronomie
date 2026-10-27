CREATE TYPE "TenantKind" AS ENUM ('REAL', 'DEMO', 'LOCAL_PILOT', 'LEGACY_CI');
ALTER TABLE "Tenant" ADD COLUMN "kind" "TenantKind" NOT NULL DEFAULT 'REAL',
  ADD COLUMN "businessProfileId" TEXT, ADD COLUMN "businessProfileVersion" INTEGER;
UPDATE "Tenant" SET "kind" = 'LEGACY_CI'
  WHERE "id" = 'demo-tenant' AND "slug" = 'flowgastronomie-demo';
CREATE UNIQUE INDEX IF NOT EXISTS "Venue_tenantId_id_key" ON "Venue"("tenantId", "id");
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");
CREATE TABLE "BusinessProvision" (
  "requestKeyHash" TEXT PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "profileSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessProvision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessProvision_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessProvision_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessProvision_tenantId_key" ON "BusinessProvision"("tenantId");
