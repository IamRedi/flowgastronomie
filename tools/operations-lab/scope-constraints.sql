-- Additive, idempotent upgrade of LAB-ONLY orchestration tables.
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS operations_lab.archive_print (
    job_id text PRIMARY KEY,receipt_id text NOT NULL REFERENCES operations_lab.archive(receipt_id),
    tenant_id text NOT NULL,venue_id text NOT NULL,content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_archive_identity' AND connamespace='operations_lab'::regnamespace) THEN
    ALTER TABLE operations_lab.archive ADD CONSTRAINT lab_archive_identity UNIQUE(receipt_id,tenant_id,venue_id,content_hash);
    ALTER TABLE operations_lab.archive_print ADD CONSTRAINT lab_archive_print_identity FOREIGN KEY(receipt_id,tenant_id,venue_id,content_hash) REFERENCES operations_lab.archive(receipt_id,tenant_id,venue_id,content_hash);
  END IF;
  IF to_regclass('public."PrintJob"') IS NOT NULL THEN
    INSERT INTO operations_lab.archive_print(job_id,receipt_id,tenant_id,venue_id,content_hash)
    SELECT j.id,j."receiptId",j."tenantId",j."venueId",a.content_hash
    FROM public."PrintJob" j JOIN operations_lab.archive a ON a.receipt_id=j."receiptId" AND a.tenant_id=j."tenantId" AND a.venue_id=j."venueId"
    WHERE j.status='PRINTED' ON CONFLICT(job_id) DO NOTHING;
  END IF;
  ALTER TABLE operations_lab.action ADD COLUMN IF NOT EXISTS actor_session_id text;
  ALTER TABLE operations_lab.action ADD COLUMN IF NOT EXISTS result_source_ids jsonb NOT NULL DEFAULT '[]';
  ALTER TABLE operations_lab.action ADD COLUMN IF NOT EXISTS browser_key text;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_venue_scope' AND connamespace='operations_lab'::regnamespace) THEN
    ALTER TABLE operations_lab.venue ADD CONSTRAINT lab_venue_scope UNIQUE (tenant_id,venue_id);
    ALTER TABLE operations_lab.run ADD CONSTRAINT lab_run_scope UNIQUE (id,tenant_id,venue_id);
    ALTER TABLE operations_lab.run ADD CONSTRAINT lab_run_venue_scope FOREIGN KEY (tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id);
    ALTER TABLE operations_lab.action ADD CONSTRAINT lab_action_run_scope FOREIGN KEY (run_id,tenant_id,venue_id) REFERENCES operations_lab.run(id,tenant_id,venue_id);
    ALTER TABLE operations_lab.archive ADD CONSTRAINT lab_archive_venue_scope FOREIGN KEY (tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id);
  END IF;
END $$;
