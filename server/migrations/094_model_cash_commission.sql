-- New orders snapshot the rule. Historical orders/commissions are never repriced.
ALTER TABLE model_pack_offers ADD COLUMN IF NOT EXISTS cost_bps integer NOT NULL DEFAULT 3500 CHECK(cost_bps BETWEEN 0 AND 10000);
ALTER TABLE cw_commissions ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'legacy' CHECK(basis IN ('legacy','consumed_cash_v1'));
ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS model_cost_bps integer CHECK(model_cost_bps BETWEEN 0 AND 10000);
-- Cost estimate, not an actual supplier invoice/payment. Preserve sub-cent precision.
ALTER TABLE credit_consumptions ADD COLUMN IF NOT EXISTS estimated_cost_fen numeric(30,10);
