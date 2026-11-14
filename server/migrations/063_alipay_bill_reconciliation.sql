-- Merchant statements are reconciliation evidence, never customer ledger entries.
CREATE TABLE IF NOT EXISTS alipay_bill_days (
 bill_date date PRIMARY KEY, status text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 source_sha256 text, matched integer NOT NULL DEFAULT 0, exceptions integer NOT NULL DEFAULT 0,
 ignored integer NOT NULL DEFAULT 0, error_code text
);
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_source text;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_issue text;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel_fee_issue_day date;
