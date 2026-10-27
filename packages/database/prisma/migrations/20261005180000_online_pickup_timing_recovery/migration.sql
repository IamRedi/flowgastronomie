ALTER TABLE "Venue" ADD COLUMN "pickupLeadMinutes" INTEGER;
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_pickupLeadMinutes_check"
  CHECK ("pickupLeadMinutes" IS NULL OR "pickupLeadMinutes" BETWEEN 1 AND 240);
ALTER TABLE "OnlineOrder" ADD COLUMN "productionNotBefore" TIMESTAMP(3);
-- Existing pickup orders also respect their venue's configured preparation window.
-- An unconfigured venue has no invented lead time: pickup time is the boundary.
UPDATE "OnlineOrder" o SET "productionNotBefore" = o."requestedFor"
  - COALESCE(v."pickupLeadMinutes", 0) * INTERVAL '1 minute'
  FROM "Venue" v WHERE v.id = o."venueId" AND o."fulfillmentType" = 'PICKUP';
CREATE TABLE "OnlineOrderRecoverySession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "onlineOrderId" TEXT NOT NULL REFERENCES "OnlineOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OnlineOrderRecoverySession_tokenHash_key" ON "OnlineOrderRecoverySession"("tokenHash");
CREATE INDEX "OnlineOrderRecoverySession_tenantId_venueId_expiresAt_idx" ON "OnlineOrderRecoverySession"("tenantId", "venueId", "expiresAt");
CREATE INDEX "OnlineOrderRecoverySession_expiresAt_idx" ON "OnlineOrderRecoverySession"("expiresAt");
