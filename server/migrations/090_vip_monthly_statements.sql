-- Personal VIP inbox: immutable PDF revisions, never customer identity or raw order numbers.
CREATE TABLE IF NOT EXISTS cw_vip_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES cw_partners(id),
 month text NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 latest_revision integer NOT NULL DEFAULT 0, read_revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(partner_id,month), CHECK(read_revision BETWEEN 0 AND latest_revision)
);
CREATE TABLE IF NOT EXISTS cw_vip_statement_versions (
 statement_id uuid NOT NULL REFERENCES cw_vip_statements(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0), snapshot jsonb NOT NULL,
 pdf bytea NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 generated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(statement_id,revision)
);
CREATE TABLE IF NOT EXISTS cw_vip_statement_events (
 statement_id uuid NOT NULL REFERENCES cw_vip_statements(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES cw_commission_events(id), PRIMARY KEY(statement_id,event_id)
);
CREATE INDEX IF NOT EXISTS cw_vip_statement_partner ON cw_vip_statements(partner_id,month DESC);
CREATE INDEX IF NOT EXISTS cw_events_occurred ON cw_commission_events(occurred_at,order_id);
