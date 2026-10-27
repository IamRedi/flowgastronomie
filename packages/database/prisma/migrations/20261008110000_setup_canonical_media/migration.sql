ALTER TABLE "SmartSetup"
  ADD COLUMN "mediaStep" INTEGER NOT NULL DEFAULT 1 CHECK ("mediaStep" BETWEEN 1 AND 4),
  ADD COLUMN "mediaStatus" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("mediaStatus" IN ('PENDING','IN_PROGRESS','COMPLETE','SKIPPED')),
  ADD COLUMN "mediaDraft" JSONB;

-- Content, approval and provenance are immutable snapshots. Replacements and
-- later approvals create new assets/associations, never rewrite old evidence.
CREATE FUNCTION prevent_media_asset_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Canonical media assets are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_asset_immutable BEFORE UPDATE ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION prevent_media_asset_rewrite();
