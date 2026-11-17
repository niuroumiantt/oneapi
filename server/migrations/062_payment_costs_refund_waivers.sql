-- Actual channel cost, independent of customer credit. NULL means not reconciled.
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_fen bigint CHECK(channel_fee_fen>=0);
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_evidence text;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_recorded_by text;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_recorded_at timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_version integer NOT NULL DEFAULT 0;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS service_fee_percent integer NOT NULL DEFAULT 15 CHECK(service_fee_percent BETWEEN 0 AND 15);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS waiver_reason text;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS waiver_approved_by text;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS waiver_approved_at timestamptz;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS standard_net_fen bigint;
