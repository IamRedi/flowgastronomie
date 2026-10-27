-- Only the dedicated Compose database runs this file. Never applied to main DBs.
CREATE SCHEMA operations_lab;
CREATE TABLE operations_lab.instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  marker text NOT NULL CHECK (marker = 'RESTAURANTFLOW_OPERATIONS_LAB_V1'),
  system_identifier text NOT NULL
);
INSERT INTO operations_lab.instance (marker, system_identifier)
SELECT 'RESTAURANTFLOW_OPERATIONS_LAB_V1', system_identifier::text FROM pg_control_system();
CREATE TABLE operations_lab.venue (
  profile text PRIMARY KEY CHECK (profile IN ('DE','AL')),
  tenant_id text NOT NULL UNIQUE,
  venue_id text NOT NULL UNIQUE,
  owner_email text NOT NULL CHECK (owner_email LIKE '%@operations-lab.invalid')
);
CREATE TABLE operations_lab.run (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  venue_id text NOT NULL REFERENCES operations_lab.venue(venue_id),
  version integer NOT NULL CHECK (version = 1),
  scenario_version text NOT NULL,
  seed integer NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','PAUSED','NEEDS_REVIEW','COMPLETED','STOP_AFTER_SHIFT')),
  checkpoint jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, venue_id, business_date, scenario_version)
);
CREATE TABLE operations_lab.action (
  event_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES operations_lab.run(id),
  tenant_id text NOT NULL,
  venue_id text NOT NULL REFERENCES operations_lab.venue(venue_id),
  version integer NOT NULL CHECK (version = 1),
  actor text NOT NULL,
  actor_session_id text,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','LEASED','SUCCEEDED','NEEDS_REVIEW','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  expected jsonb NOT NULL,
  result jsonb,
  result_source_ids jsonb NOT NULL DEFAULT '[]',
  browser_key text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations_lab.archive (
  receipt_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  venue_id text NOT NULL REFERENCES operations_lab.venue(venue_id),
  source_hash text NOT NULL,
  content_hash text NOT NULL,
  filename text NOT NULL UNIQUE,
  renderer_version integer NOT NULL CHECK (renderer_version = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
