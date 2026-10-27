-- Additive LAB-ONLY scheduling/control/journal metadata, never business writes.
ALTER TABLE operations_lab.archive ADD COLUMN IF NOT EXISTS byte_size integer;
CREATE INDEX IF NOT EXISTS lab_archive_scope_time ON operations_lab.archive(tenant_id,venue_id,created_at DESC);
CREATE TABLE IF NOT EXISTS operations_lab.control (
 profile text PRIMARY KEY REFERENCES operations_lab.venue(profile),tenant_id text NOT NULL,venue_id text NOT NULL,
 version integer NOT NULL DEFAULT 1,mode text NOT NULL DEFAULT 'STOPPED' CHECK(mode IN ('STOPPED','RUNNING','PAUSED','STOP_AFTER_DAY','NEEDS_REVIEW')),
 config jsonb NOT NULL,current_run_id text,lease_owner text,lease_until timestamptz,heartbeat_at timestamptz,checkpoint_at timestamptz,incident text,
 FOREIGN KEY(tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id),
 FOREIGN KEY(current_run_id,tenant_id,venue_id) REFERENCES operations_lab.run(id,tenant_id,venue_id)
);
CREATE TABLE IF NOT EXISTS operations_lab.day (
 run_id text PRIMARY KEY,profile text NOT NULL REFERENCES operations_lab.control(profile),tenant_id text NOT NULL,venue_id text NOT NULL,
 config jsonb NOT NULL,opens_at timestamptz NOT NULL,closes_at timestamptz NOT NULL,opened boolean NOT NULL DEFAULT false,
 fault_position integer,report jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,tenant_id,venue_id) REFERENCES operations_lab.run(id,tenant_id,venue_id)
);
CREATE TABLE IF NOT EXISTS operations_lab.job (
 id text PRIMARY KEY,run_id text NOT NULL,tenant_id text NOT NULL,venue_id text NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version=1),
 intent jsonb NOT NULL,stage text NOT NULL CHECK(stage IN ('ARRIVE','PREPARE','READY','SETTLE','FINAL','DONE')),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','LEASED','DONE','MISSED','NEEDS_REVIEW')),
 due_at timestamptz NOT NULL,order_id text,lane integer,attempts integer NOT NULL DEFAULT 0,lease_owner text,lease_until timestamptz,last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,tenant_id,venue_id) REFERENCES operations_lab.run(id,tenant_id,venue_id)
);
CREATE INDEX IF NOT EXISTS lab_job_due ON operations_lab.job(run_id,status,due_at);
CREATE INDEX IF NOT EXISTS lab_action_actor_lease ON operations_lab.action(tenant_id,venue_id,actor,lease_until) WHERE status='LEASED';
CREATE INDEX IF NOT EXISTS lab_run_day ON operations_lab.run(tenant_id,venue_id,business_date);
CREATE TABLE IF NOT EXISTS operations_lab.journal (
 seq bigserial PRIMARY KEY,event_id text NOT NULL UNIQUE,run_id text,tenant_id text NOT NULL,venue_id text NOT NULL,
 kind text NOT NULL,messages jsonb NOT NULL,facts jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id),
 FOREIGN KEY(run_id,tenant_id,venue_id) REFERENCES operations_lab.run(id,tenant_id,venue_id)
);
CREATE INDEX IF NOT EXISTS lab_journal_page ON operations_lab.journal(tenant_id,venue_id,seq DESC);
CREATE INDEX IF NOT EXISTS lab_journal_week ON operations_lab.journal(tenant_id,venue_id,created_at);
