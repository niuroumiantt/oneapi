ALTER TABLE promotion_campaigns ADD COLUMN IF NOT EXISTS price_proposal_id uuid REFERENCES model_price_proposals(id);
CREATE INDEX IF NOT EXISTS promotion_campaigns_price_idx ON promotion_campaigns(price_proposal_id);
