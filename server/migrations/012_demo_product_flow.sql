-- Demo-only product selection and accounting. Never mix with production funds.
ALTER TABLE demo_orders ALTER COLUMN model_code DROP NOT NULL;
ALTER TABLE demo_orders ADD COLUMN IF NOT EXISTS refunded_fen bigint NOT NULL DEFAULT 0 CHECK(refunded_fen>=0);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='demo_orders_refund_within_paid') THEN
  ALTER TABLE demo_orders ADD CONSTRAINT demo_orders_refund_within_paid CHECK(refunded_fen<=amount_fen);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS demo_model_grants (
 wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 model_code text NOT NULL,
 selected_by text NOT NULL REFERENCES "user"(id),
 selected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(wallet_id,model_code)
);
CREATE TABLE IF NOT EXISTS demo_key_models (
 key_id uuid NOT NULL REFERENCES demo_keys(id) ON DELETE CASCADE,
 model_code text NOT NULL,
 PRIMARY KEY(key_id,model_code)
);
INSERT INTO demo_model_grants(wallet_id,model_code,selected_by)
 SELECT DISTINCT o.wallet_id,o.model_code,o.created_by FROM demo_orders o
 WHERE o.status='paid' AND o.model_code IS NOT NULL
 ON CONFLICT DO NOTHING;
INSERT INTO demo_key_models(key_id,model_code)
 SELECT id,model_code FROM demo_keys ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS demo_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 kind text NOT NULL CHECK(kind IN ('payment','usage','refund')),
 amount_fen bigint NOT NULL CHECK(amount_fen<>0),
 reference_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,reference_id)
);
INSERT INTO demo_ledger(wallet_id,kind,amount_fen,reference_id)
 SELECT wallet_id,'payment',amount_fen,id FROM demo_orders WHERE status='paid'
 ON CONFLICT DO NOTHING;
INSERT INTO demo_ledger(wallet_id,kind,amount_fen,reference_id)
 SELECT wallet_id,'usage',-cost_fen,id FROM demo_usage
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS demo_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),
 fee_fen bigint NOT NULL DEFAULT 0 CHECK(fee_fen>=0),
 status text NOT NULL DEFAULT 'simulated' CHECK(status='simulated'),
 created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS demo_refund_sources (
 refund_id uuid NOT NULL REFERENCES demo_refunds(id),
 order_id uuid NOT NULL REFERENCES demo_orders(id),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),
 PRIMARY KEY(refund_id,order_id)
);
