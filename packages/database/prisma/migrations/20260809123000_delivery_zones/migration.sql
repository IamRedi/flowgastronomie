CREATE TABLE "DeliveryZone" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "postalPrefixes" TEXT[] NOT NULL,
  "feeMinor" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderMinor" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryZone_tenantId_venueId_active_sortOrder_idx" ON "DeliveryZone"("tenantId", "venueId", "active", "sortOrder");
ALTER TABLE "OnlineOrder" ADD COLUMN "deliveryZoneId" TEXT;
ALTER TABLE "OnlineOrder" ADD COLUMN "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_deliveryZoneId_fkey" FOREIGN KEY ("deliveryZoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
