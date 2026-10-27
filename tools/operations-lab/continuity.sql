-- Additive LAB metadata only; no commercial tables/plans are changed by DDL.
CREATE TABLE IF NOT EXISTS operations_lab.entitlement_opt_in (
 profile text PRIMARY KEY REFERENCES operations_lab.venue(profile),tenant_id text NOT NULL,venue_id text NOT NULL,
 approved_by text NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 300),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id)
);
CREATE TABLE IF NOT EXISTS operations_lab.entitlement_event (
 id text PRIMARY KEY,profile text NOT NULL REFERENCES operations_lab.entitlement_opt_in(profile),tenant_id text NOT NULL,venue_id text NOT NULL,
 subscription_id text NOT NULL,previous_until timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until>previous_until),CHECK(valid_until<=created_at+interval '31 days'),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES operations_lab.venue(tenant_id,venue_id)
);
CREATE INDEX IF NOT EXISTS lab_entitlement_history ON operations_lab.entitlement_event(tenant_id,created_at DESC);
CREATE OR REPLACE FUNCTION operations_lab.reject_entitlement_rewrite() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'LAB entitlement approval/evidence is append-only'; END $fn$;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lab_opt_in_immutable' AND tgrelid='operations_lab.entitlement_opt_in'::regclass) THEN
 CREATE TRIGGER lab_opt_in_immutable BEFORE UPDATE OR DELETE ON operations_lab.entitlement_opt_in FOR EACH ROW EXECUTE FUNCTION operations_lab.reject_entitlement_rewrite();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lab_entitlement_immutable' AND tgrelid='operations_lab.entitlement_event'::regclass) THEN
 CREATE TRIGGER lab_entitlement_immutable BEFORE UPDATE OR DELETE ON operations_lab.entitlement_event FOR EACH ROW EXECUTE FUNCTION operations_lab.reject_entitlement_rewrite();
END IF;
