CREATE TABLE IF NOT EXISTS model_price_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 model_product_id uuid NOT NULL REFERENCES model_products(id),
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 input_fen_per_million bigint NOT NULL CHECK(input_fen_per_million > 0),
 output_fen_per_million bigint NOT NULL CHECK(output_fen_per_million > 0),
 evidence_url text NOT NULL CHECK(length(evidence_url) BETWEEN 9 AND 500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_price_proposals_product_created_idx ON model_price_proposals(model_product_id,created_at DESC);
