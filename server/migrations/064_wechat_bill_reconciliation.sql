CREATE TABLE IF NOT EXISTS wechat_bill_days (
 bill_date date PRIMARY KEY, status text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 source_sha256 text, matched integer NOT NULL DEFAULT 0, exceptions integer NOT NULL DEFAULT 0,
 ignored integer NOT NULL DEFAULT 0, error_code text
);
-- One row per receipt/refund, replaced rather than added on repeated downloads.
CREATE TABLE IF NOT EXISTS wechat_bill_entries (
 entry_key text PRIMARY KEY, order_id uuid NOT NULL REFERENCES payment_orders(id),
 bill_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('SUCCESS','REFUND')),
 amount_fen bigint NOT NULL, fee_fen bigint NOT NULL, source_sha256 text NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_bill_entries_order ON wechat_bill_entries(order_id);
-- Use actual fee dates for automatic WeChat entries, including cross-month fee returns.
CREATE OR REPLACE VIEW payment_channel_costs AS
 SELECT id AS order_id, (paid_at AT TIME ZONE 'Asia/Shanghai')::date AS cost_day,channel_fee_fen AS fee_fen
 FROM payment_orders WHERE status='paid' AND channel_fee_source IS DISTINCT FROM 'wechat_bill'
 UNION ALL
 SELECT e.order_id,e.bill_date,e.fee_fen FROM wechat_bill_entries e JOIN payment_orders o ON o.id=e.order_id WHERE o.channel_fee_source='wechat_bill';
