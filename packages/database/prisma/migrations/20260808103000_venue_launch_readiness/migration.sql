CREATE TABLE "VenueLaunch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "rehearsalConfirmedAt" TIMESTAMP(3),
    "rehearsalByUserId" TEXT,
    "launchedAt" TIMESTAMP(3),
    "launchedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VenueLaunch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueLaunch_venueId_key" ON "VenueLaunch"("venueId");
CREATE INDEX "VenueLaunch_tenantId_launchedAt_idx" ON "VenueLaunch"("tenantId", "launchedAt");

ALTER TABLE "VenueLaunch" ADD CONSTRAINT "VenueLaunch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueLaunch" ADD CONSTRAINT "VenueLaunch_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
