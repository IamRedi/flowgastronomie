CREATE TABLE "SmartSetup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "profileVersion" INTEGER NOT NULL,
  "step" INTEGER NOT NULL DEFAULT 1 CHECK ("step" BETWEEN 1 AND 4),
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK ("status" IN ('IN_PROGRESS', 'READY')),
  "skipped" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "appliedProfiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 0,
  "activeImportSessionId" TEXT,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartSetup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmartSetup_venue_scope_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SmartSetup_tenantId_venueId_key" ON "SmartSetup"("tenantId", "venueId");
