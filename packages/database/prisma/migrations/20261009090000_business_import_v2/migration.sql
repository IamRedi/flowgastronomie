-- Extend the existing private review workspace; canonical menu/media stay unchanged.
ALTER TABLE "ImportSession" ADD COLUMN "businessData" JSONB;
ALTER TABLE "ImportSession" ADD COLUMN "businessReceipt" JSONB;
ALTER TABLE "ImportSource" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "ImportSource" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'DOCUMENT';
-- Safe import reversal retains canonical IDs and provenance without exposing additions.
ALTER TABLE "Product" ADD COLUMN "archivedAt" TIMESTAMP(3);
