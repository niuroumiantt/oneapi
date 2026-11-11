-- Online recharge orders. Funds reach billing_ledger only after a signed Alipay result
-- (notify or active query) confirms the exact amount for this order.
CREATE TABLE IF NOT EXISTS payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 out_trade_no text NOT NULL UNIQUE,
 account_id uuid NOT NULL REFERENCES billing_accounts(id),
 created_by text NOT NULL REFERENCES "user"(id),
 provider text NOT NULL CHECK(provider IN ('alipay_f2f')),
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 amount_fen bigint NOT NULL CHECK(amount_fen>=500 AND amount_fen<=5000000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','closed')),
 qr_code text,
 provider_trade_no text UNIQUE,
 idempotency_key text NOT NULL,
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,idempotency_key),
 CHECK ((status='paid')=(paid_at IS NOT NULL AND provider_trade_no IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS payment_orders_account_idx ON payment_orders(account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_pending_idx ON payment_orders(expires_at) WHERE status='pending';
