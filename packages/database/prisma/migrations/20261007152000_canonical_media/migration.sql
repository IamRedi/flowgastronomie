CREATE TYPE "MediaSource" AS ENUM ('UPLOAD','IMPORT','GENERATED','DEMO','SYSTEM');
CREATE TYPE "VenueMediaRole" AS ENUM ('LOGO','HERO','GALLERY','PROFILE');
CREATE TYPE "ProductMediaRole" AS ENUM ('PRIMARY','GALLERY');
CREATE UNIQUE INDEX "Product_tenantId_venueId_id_key" ON "Product"("tenantId","venueId","id");
CREATE TABLE "MediaAsset" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL,
 "source" "MediaSource" NOT NULL, "sourceKey" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL, "width" INTEGER NOT NULL CHECK ("width" > 0), "height" INTEGER NOT NULL CHECK ("height" > 0),
 "contentHash" TEXT NOT NULL, "storageLocation" TEXT NOT NULL DEFAULT 'DATABASE', "bytes" BYTEA NOT NULL,
 "provenance" JSONB NOT NULL, "approvedForPublicUse" BOOLEAN NOT NULL DEFAULT false,
 "createdByUserId" TEXT NOT NULL, "approvedByUserId" TEXT NOT NULL,
 "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MediaAsset_tenantId_venueId_fkey" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("tenantId","venueId","id"), UNIQUE ("tenantId","venueId","sourceKey"),
 CHECK ("source" <> 'DEMO' OR NOT "approvedForPublicUse")
);
CREATE TABLE "VenueMedia" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
 "role" "VenueMediaRole" NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","venueId","mediaAssetId") REFERENCES "MediaAsset"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("tenantId","venueId","role","sortOrder"),
 CHECK ("sortOrder" >= 0 AND ("role" = 'GALLERY' OR "sortOrder" = 0))
);
CREATE TABLE "ProductMedia" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT NOT NULL, "productId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
 "role" "ProductMediaRole" NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY ("tenantId","venueId","productId") REFERENCES "Product"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","venueId","mediaAssetId") REFERENCES "MediaAsset"("tenantId","venueId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("tenantId","venueId","productId","role","sortOrder"),
 CHECK ("sortOrder" >= 0 AND ("role" = 'GALLERY' OR "sortOrder" = 0))
);
