CREATE TYPE "WebsiteStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "VenueWebsite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'DRAFT',
    "primaryColor" TEXT NOT NULL DEFAULT '#17382f',
    "accentColor" TEXT NOT NULL DEFAULT '#ed6b37',
    "logoUrl" TEXT,
    "heroImageUrl" TEXT,
    "phone" TEXT,
    "contactEmail" TEXT,
    "address" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "openingHours" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueWebsite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueWebsiteTranslation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "heroTitle" TEXT NOT NULL,
    "heroSubtitle" TEXT NOT NULL,
    "storyTitle" TEXT NOT NULL,
    "storyBody" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,

    CONSTRAINT "VenueWebsiteTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueWebsite_venueId_key" ON "VenueWebsite"("venueId");
CREATE UNIQUE INDEX "VenueWebsite_publicSlug_key" ON "VenueWebsite"("publicSlug");
CREATE INDEX "VenueWebsite_tenantId_status_idx" ON "VenueWebsite"("tenantId", "status");
CREATE UNIQUE INDEX "VenueWebsiteTranslation_websiteId_locale_key" ON "VenueWebsiteTranslation"("websiteId", "locale");
CREATE INDEX "VenueWebsiteTranslation_tenantId_venueId_locale_idx" ON "VenueWebsiteTranslation"("tenantId", "venueId", "locale");

ALTER TABLE "VenueWebsite" ADD CONSTRAINT "VenueWebsite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueWebsite" ADD CONSTRAINT "VenueWebsite_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueWebsiteTranslation" ADD CONSTRAINT "VenueWebsiteTranslation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "VenueWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
