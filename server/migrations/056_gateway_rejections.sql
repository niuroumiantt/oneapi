-- Gateway 429 counts by day / reason / layer (owner decision 2026-11-12, docs/14-gateway-settings.md C1–C3).
-- Gateway-own rejections used to leave no row, so defaults could not be checked against reality.
-- Empty owner_id / nil UUIDs mean "not applicable" so the unique key works on older Postgres too.
CREATE TABLE IF NOT EXISTS gateway_rejection_counts (
  day date NOT NULL,
  code text NOT NULL,
  layer text NOT NULL,
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  owner_id text NOT NULL DEFAULT '',
  key_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, code, layer, organization_id, owner_id, key_id)
);
CREATE INDEX IF NOT EXISTS gateway_rejection_counts_day_code ON gateway_rejection_counts (day, code);
