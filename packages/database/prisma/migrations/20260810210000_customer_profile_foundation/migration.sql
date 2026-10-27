CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "emailNormalized" TEXT,
    "phoneNormalized" TEXT,
    "preferredLocale" "Locale" NOT NULL DEFAULT 'SQ',
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Reservation" ADD COLUMN "customerProfileId" TEXT;
ALTER TABLE "OnlineOrder" ADD COLUMN "customerProfileId" TEXT;

CREATE INDEX "CustomerProfile_tenantId_venueId_emailNormalized_idx" ON "CustomerProfile"("tenantId", "venueId", "emailNormalized");
CREATE INDEX "CustomerProfile_tenantId_venueId_phoneNormalized_idx" ON "CustomerProfile"("tenantId", "venueId", "phoneNormalized");
CREATE INDEX "Reservation_customerProfileId_idx" ON "Reservation"("customerProfileId");
CREATE INDEX "OnlineOrder_customerProfileId_idx" ON "OnlineOrder"("customerProfileId");

ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
