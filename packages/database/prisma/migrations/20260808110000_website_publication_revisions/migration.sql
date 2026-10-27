CREATE TABLE "WebsitePublicationRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedByUserId" TEXT NOT NULL,
    "publishedByMembershipId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsitePublicationRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsitePublicationRevision_websiteId_revision_key" ON "WebsitePublicationRevision"("websiteId", "revision");
CREATE INDEX "WebsitePublicationRevision_tenantId_venueId_publishedAt_idx" ON "WebsitePublicationRevision"("tenantId", "venueId", "publishedAt");

ALTER TABLE "WebsitePublicationRevision" ADD CONSTRAINT "WebsitePublicationRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsitePublicationRevision" ADD CONSTRAINT "WebsitePublicationRevision_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsitePublicationRevision" ADD CONSTRAINT "WebsitePublicationRevision_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "VenueWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
