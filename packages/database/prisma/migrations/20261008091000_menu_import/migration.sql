CREATE TABLE "ImportSession" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "locale" "Locale" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DETECTED' CHECK ("status" IN ('DETECTED','NEEDS_REVIEW','APPROVED','REJECTED','IMPORTED')),
  "version" INTEGER NOT NULL DEFAULT 0,
  "extractionState" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("extractionState" IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  "extractionKey" TEXT, "extractionAttempts" INTEGER NOT NULL DEFAULT 0,
  "extractionStartedAt" TIMESTAMP(3), "extractionFinishedAt" TIMESTAMP(3),
  "provider" TEXT, "model" TEXT, "provenance" JSONB, "proposal" JSONB, "errorCode" TEXT,
  "importedAt" TIMESTAMP(3), "importedBy" TEXT, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportSession_tenantId_venueId_id_key" ON "ImportSession"("tenantId","venueId","id");
CREATE UNIQUE INDEX "ImportSession_tenantId_venueId_requestKey_key" ON "ImportSession"("tenantId","venueId","requestKey");
CREATE INDEX "ImportSession_tenantId_venueId_createdAt_idx" ON "ImportSession"("tenantId","venueId","createdAt");
ALTER TABLE "SmartSetup" ADD CONSTRAINT "SmartSetup_activeImport_scope_fkey" FOREIGN KEY ("tenantId","venueId","activeImportSessionId") REFERENCES "ImportSession"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ImportSource" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "filename" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL, "pageCount" INTEGER NOT NULL,
  "mediaAssetId" TEXT, "documentBytes" BYTEA, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("mediaAssetId" IS NOT NULL AND "documentBytes" IS NULL) OR ("mediaAssetId" IS NULL AND "documentBytes" IS NOT NULL)),
  FOREIGN KEY ("tenantId","venueId","sessionId") REFERENCES "ImportSession"("tenantId","venueId","id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","venueId","mediaAssetId") REFERENCES "MediaAsset"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportSource_tenantId_venueId_id_key" ON "ImportSource"("tenantId","venueId","id");
CREATE UNIQUE INDEX "ImportSource_tenantId_venueId_sessionId_contentHash_key" ON "ImportSource"("tenantId","venueId","sessionId","contentHash");
CREATE TABLE "ImportItem" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "proposalItemId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK ("status" IN ('DETECTED','NEEDS_REVIEW','APPROVED','REJECTED','IMPORTED')),
  "original" JSONB NOT NULL, "reviewed" JSONB NOT NULL,
  "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "importedProductId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("tenantId","venueId","sessionId") REFERENCES "ImportSession"("tenantId","venueId","id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","venueId","importedProductId") REFERENCES "Product"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportItem_tenantId_venueId_id_key" ON "ImportItem"("tenantId","venueId","id");
CREATE UNIQUE INDEX "ImportItem_tenantId_venueId_sessionId_proposalItemId_key" ON "ImportItem"("tenantId","venueId","sessionId","proposalItemId");
