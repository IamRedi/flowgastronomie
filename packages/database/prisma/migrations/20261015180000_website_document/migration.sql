-- Additive opt-in document; NULL preserves the existing renderer and snapshots.
ALTER TABLE "VenueWebsite" ADD COLUMN "document" JSONB;
