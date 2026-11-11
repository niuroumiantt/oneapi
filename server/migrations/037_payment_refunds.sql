-- Staff-initiated refunds of Alipay recharges, returned to the original payer.
-- The amount is held from the account balance when the refund is requested (ledger kind
-- 'refund'); a refund Alipay definitively rejects is released by a 'reversal' entry.
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS refunded_fen bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_orders_refunded_range') THEN
  ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_refunded_range CHECK(refunded_fen>=0 AND refunded_fen<=amount_fen);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS payment_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES payment_orders(id),
 out_request_no text NOT NULL UNIQUE,
 amount_fen bigint NOT NULL CHECK(amount_fen>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),
 error_code text,
 requested_by text NOT NULL,
 idempotency_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK ((status='pending')=(completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds(order_id,created_at);
-- At most one refund in flight per order keeps Alipay's per-request idempotency simple.
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_one_pending ON payment_refunds(order_id) WHERE status='pending';
