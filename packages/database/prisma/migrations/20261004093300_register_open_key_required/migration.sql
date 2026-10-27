-- CHECK expressions accept NULL. Require the open-session key explicitly so
-- the existing unique key enforces one OPEN register even for direct SQL.
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_open_key_required"
CHECK ("status" <> 'OPEN' OR "activeVenueKey" IS NOT NULL);
