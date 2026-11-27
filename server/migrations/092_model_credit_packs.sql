-- Migrations are replayed on startup. All additions are idempotent.
-- Publish a new offer version by disabling the old row and inserting a new row in one transaction.
-- Existing quotes are rechecked before the order is created, paid orders retain their snapshots.
CREATE TABLE IF NOT EXISTS model_pack_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 model_id text NOT NULL CHECK(model_id<>''),
 min_price_bps integer NOT NULL CHECK(min_price_bps BETWEEN 1 AND 10000),
 settlement_bps integer NOT NULL CHECK(settlement_bps BETWEEN 0 AND min_price_bps),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS model_pack_current_offer ON model_pack_offers(model_id) WHERE enabled;
ALTER TABLE cw_codes ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE cw_codes ADD COLUMN IF NOT EXISTS model_price_bps integer CHECK(model_price_bps BETWEEN 1 AND 10000);
ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS model_settlement_bps integer CHECK(model_settlement_bps BETWEEN 0 AND 10000);
ALTER TABLE cw_commission_events ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE cw_commission_events ADD COLUMN IF NOT EXISTS face_fen numeric(30,10);
CREATE INDEX IF NOT EXISTS credit_packs_eligible ON credit_packs(account_id,model_id,created_at,id)
 WHERE remaining_fen>0 AND refund_id IS NULL;
CREATE INDEX IF NOT EXISTS customer_calls_held_model ON customer_calls(account_id,model_id)
 WHERE status IN ('pending','awaiting_bill');
