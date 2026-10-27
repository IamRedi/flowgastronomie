CREATE TYPE "WebsiteDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'FAILED');
CREATE TYPE "WebsiteAssetKind" AS ENUM ('LOGO', 'HERO');

CREATE TABLE "WebsiteDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "WebsiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebsiteDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "kind" "WebsiteAssetKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebsiteAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteDomain_venueId_key" ON "WebsiteDomain"("venueId");
CREATE UNIQUE INDEX "WebsiteDomain_websiteId_key" ON "WebsiteDomain"("websiteId");
CREATE UNIQUE INDEX "WebsiteDomain_hostname_key" ON "WebsiteDomain"("hostname");
CREATE INDEX "WebsiteDomain_tenantId_status_idx" ON "WebsiteDomain"("tenantId", "status");
CREATE UNIQUE INDEX "WebsiteAsset_websiteId_kind_key" ON "WebsiteAsset"("websiteId", "kind");
CREATE INDEX "WebsiteAsset_tenantId_venueId_idx" ON "WebsiteAsset"("tenantId", "venueId");

ALTER TABLE "WebsiteDomain" ADD CONSTRAINT "WebsiteDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteDomain" ADD CONSTRAINT "WebsiteDomain_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteDomain" ADD CONSTRAINT "WebsiteDomain_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "VenueWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteAsset" ADD CONSTRAINT "WebsiteAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteAsset" ADD CONSTRAINT "WebsiteAsset_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteAsset" ADD CONSTRAINT "WebsiteAsset_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "VenueWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
